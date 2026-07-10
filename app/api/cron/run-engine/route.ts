import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { createMeter } from "@/src/roi/cost-meter";
import { drizzleCostRecorder } from "@/db/cost-recorder";
import { detectorRegistry } from "@/jobs/run-detectors";
import {
  buildLiveDiscoveryDeps,
  DEFAULT_DISCOVERY_TENANT_ID,
  type RunDiscoveryDeps,
} from "@/jobs/run-discovery";
import { getTenantProfile } from "@/src/discovery/tenants";
import { selectMetro } from "@/src/discovery/rotation";
import { resolveProviderKey } from "@/src/keys/provider-keys";
import {
  runEngine,
  DEFAULT_ENGINE_BRIEF_LIMIT,
  type PipelineClients,
} from "@/jobs/run-engine";
import { scrapePractice } from "@/src/enrich/scrape";
import { anthropicExtractClient } from "@/src/enrich/extract";
import { pdlClient } from "@/src/enrich/pdl-client";
import { anthropicVoiceClient } from "@/src/brief/voice";
import { resolvePracticeWebsite } from "@/src/enrich/website";

/**
 * The scheduled engine trigger (Thread 06) — the ONE heartbeat Vercel Cron pings on a schedule
 * (see `vercel.json`). It fires every signal source at once, then cascades the fresh leads into
 * cited briefs (`jobs/run-engine.ts`). Replaces the never-served Inngest cron: the schedule now
 * lives in `vercel.json`, the job runs on the same Vercel deploy the rest of the app runs on,
 * and there is no separate scheduler service, event key, or signing key to keep alive.
 *   Decision + research: eliseai-spec.md § D15 · scheduled-trigger-research/.
 *
 * SECURITY: fail-closed. Vercel attaches `Authorization: Bearer $CRON_SECRET` to cron
 * invocations when `CRON_SECRET` is set; we reject anything else. No secret set → nobody may
 * trigger it (a public engine run would burn paid API budget). This is not the R18 session gate
 * (that guards human routes); a cron has no session.
 *
 * D9: enrichment + brief only — the cascade ends at a persisted brief; NOTHING sends.
 * R19: one meter is built here and threaded through runEngine into every paid stage.
 */

// Never statically optimized — every hit runs the engine against live env + DB.
export const dynamic = "force-dynamic";
// Vercel Fluid Compute ceiling (Hobby + Pro = 300s). runEngine's briefLimit keeps a run inside it.
export const maxDuration = 300;

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // fail closed — no secret configured means no one may trigger
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

/**
 * Resolve ENGINE_BRIEF_LIMIT. A BLANK env var (`""`, exactly what .env.example ships, and what an
 * empty Vercel dashboard field yields) must fall back to the default — `??` would NOT (it only
 * catches null/undefined), so `Number("")` → 0 would silently disable the whole brief cascade
 * while still burning source spend. `||` catches the blank; NaN/negative also fall back; a
 * deliberate "0" is still honored (sources-only by choice).
 */
export function resolveBriefLimit(): number {
  const raw = process.env.ENGINE_BRIEF_LIMIT?.trim();
  if (!raw) return DEFAULT_ENGINE_BRIEF_LIMIT;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : DEFAULT_ENGINE_BRIEF_LIMIT;
}

export async function GET(request: Request): Promise<Response> {
  if (!authorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const db = getDb();
  const now = new Date();
  // One meter → every paid call this run lands a cost_events row (R19), so SCHEDULED-run spend
  // is a real scoreboard number, not an untracked leak.
  const meter = createMeter(drizzleCostRecorder(db));

  // Anthropic powers discovery's review-qualifier, enrichment extraction, and brief synthesis.
  // BYOK (U17): stored EliseAI key first, env fallback — resolveProviderKey does both.
  const anthropicApiKey = (await resolveProviderKey(db, "anthropic")) ?? undefined;
  const pdlKey = process.env.PDL_API_KEY;
  const hasGoogle = Boolean(process.env.GOOGLE_PLACES_API_KEY);

  // Discovery is the paid Google source. Skip it (don't crash the whole run) when its creds are
  // absent — the free detector sources still fire and the summary reports the skip honestly.
  let discovery: RunDiscoveryDeps | null = null;
  if (anthropicApiKey && hasGoogle) {
    const tenant = getTenantProfile(DEFAULT_DISCOVERY_TENANT_ID);
    const metro = selectMetro(tenant, now); // rotation picks this run's single metro (U6)
    discovery = buildLiveDiscoveryDeps({ db, now, tenant, metro, meter, anthropicApiKey });
  }

  // The downstream cascade needs Anthropic (extract + brief voice) AND PDL (the verified-contact
  // gap). Without both, run the free signal sources only rather than fabricate a client.
  const canBrief = Boolean(anthropicApiKey && pdlKey);
  const pipelineClients: PipelineClients | undefined = canBrief
    ? {
        scrape: (url: string) => scrapePractice({ fetch }, url),
        extract: anthropicExtractClient(anthropicApiKey as string),
        pdl: pdlClient(pdlKey as string),
        voice: anthropicVoiceClient(anthropicApiKey as string),
        // Plan B website lookup — only when Google is available; metered per practice.
        resolveWebsite: hasGoogle
          ? (p) => resolvePracticeWebsite({ meter, practiceId: p.id }, p)
          : undefined,
        // agentic escalation intentionally OFF — cost discipline (matches scripts/run-pipeline.ts).
      }
    : undefined;
  const briefLimit = pipelineClients ? resolveBriefLimit() : 0;

  const summary = await runEngine({
    db,
    meter,
    now,
    detectors: detectorRegistry,
    discovery,
    pipelineClients,
    briefLimit,
  });

  return NextResponse.json(summary);
}
