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
import { selectMetroBatch } from "@/src/discovery/rotation";
import { resolveProviderKey } from "@/src/keys/provider-keys";
import {
  runEngine,
  DEFAULT_ENGINE_BRIEF_LIMIT,
  MAX_ENGINE_BRIEF_LIMIT,
  type DownstreamCohort,
  type PipelineClients,
} from "@/jobs/run-engine";
import { scrapePractice } from "@/src/enrich/scrape";
import { dnsLookupAll } from "@/src/enrich/url-guard";
import { anthropicExtractClient } from "@/src/enrich/extract";
import { createFullEnrichClient } from "@/src/enrich/fullenrich-client";
import { createBetterContactClient } from "@/src/enrich/bettercontact-client";
import { anthropicVoiceClient } from "@/src/brief/voice";
import { resolvePracticeWebsite } from "@/src/enrich/website";
import { crossCheckSignals } from "@/src/engine/cross-check";

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

// Node runtime — the engine uses the pg driver + Node crypto; also the repo convention for every
// DB/crypto-touching route (Next 16 defaults to nodejs, but declare it so the requirement is explicit).
export const runtime = "nodejs";
// Never statically optimized — every hit runs the engine against live env + DB.
export const dynamic = "force-dynamic";
// Vercel Fluid Compute ceiling (Hobby + Pro = 300s). The brief batch size bounds paid work per invocation.
export const maxDuration = 300;

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // fail closed — no secret configured means no one may trigger
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

/**
 * Resolve ENGINE_BRIEF_LIMIT as an invocation batch size, not an eligibility cap. A BLANK env var
 * (`""`, exactly what .env.example ships, and what an empty Vercel dashboard field yields) must
 * fall back to the default; a deliberate "0" is still honored as explicit briefing-disabled mode.
 */

function resolveDownstreamCohort(request: Request): DownstreamCohort {
  const raw = new URL(request.url).searchParams.get("cohort");
  if (
    raw === "website_present" ||
    raw === "needs_contact" ||
    raw === "named_no_email" ||
    raw === "weak_email" ||
    raw === "website_missing"
  ) {
    return raw;
  }
  return "all";
}

export function resolveBriefLimit(request?: Request): number {
  const queryLimit = request ? new URL(request.url).searchParams.get("limit")?.trim() : null;
  const raw = queryLimit || process.env.ENGINE_BRIEF_LIMIT?.trim();
  if (!raw) return DEFAULT_ENGINE_BRIEF_LIMIT;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return DEFAULT_ENGINE_BRIEF_LIMIT;
  // Clamp the upper edge too: a huge value must not defeat the 300s bound with external calls.
  return Math.min(Math.floor(n), MAX_ENGINE_BRIEF_LIMIT);
}

export const DEFAULT_DISCOVERY_METRO_LIMIT = 3;
export const MAX_DISCOVERY_METRO_LIMIT = 50;
export const DEFAULT_DISCOVERY_PER_CATEGORY_LIMIT = 2;
export const MAX_DISCOVERY_PER_CATEGORY_LIMIT = 20;
export const DEFAULT_DISCOVERY_REVIEW_LIMIT = 2;
export const MAX_DISCOVERY_REVIEW_LIMIT = 5;

function resolvePositiveIntLimit(
  raw: string | null | undefined,
  fallback: number,
  max: number,
): number {
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(Math.floor(n), max);
}

export function resolveDiscoveryMetroLimit(request?: Request): number {
  const queryLimit = request
    ? new URL(request.url).searchParams.get("metroLimit")?.trim()
    : null;
  return resolvePositiveIntLimit(
    queryLimit || process.env.DISCOVERY_METRO_LIMIT?.trim(),
    DEFAULT_DISCOVERY_METRO_LIMIT,
    MAX_DISCOVERY_METRO_LIMIT,
  );
}

export function resolveDiscoveryPerCategoryLimit(request?: Request): number {
  const queryLimit = request
    ? new URL(request.url).searchParams.get("discoveryLimit")?.trim()
    : null;
  return resolvePositiveIntLimit(
    queryLimit || process.env.DISCOVERY_PER_CATEGORY_LIMIT?.trim(),
    DEFAULT_DISCOVERY_PER_CATEGORY_LIMIT,
    MAX_DISCOVERY_PER_CATEGORY_LIMIT,
  );
}

export function resolveDiscoveryReviewLimit(request?: Request): number {
  const queryLimit = request
    ? new URL(request.url).searchParams.get("reviewLimit")?.trim()
    : null;
  return resolvePositiveIntLimit(
    queryLimit || process.env.DISCOVERY_REVIEW_LIMIT?.trim(),
    DEFAULT_DISCOVERY_REVIEW_LIMIT,
    MAX_DISCOVERY_REVIEW_LIMIT,
  );
}

export async function GET(request: Request): Promise<Response> {
  if (!authorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Route setup runs OUTSIDE runEngine's per-stage isolation, so guard it here: a throw during dep
  // assembly (getDb, key resolution) becomes a logged, structured 500 instead of a bare framework
  // error — and the idempotent cron just retries next tick.
  try {
    const db = getDb();
    const now = new Date();
    // One meter → every paid call this run lands a cost_events row (R19), so SCHEDULED-run spend
    // is a real scoreboard number, not an untracked leak.
    const meter = createMeter(drizzleCostRecorder(db));

    // Anthropic powers discovery's review-qualifier, enrichment extraction, and brief synthesis.
    // BYOK (U17): stored EliseAI key first, env fallback — resolveProviderKey does both.
const anthropicApiKey =
      (await resolveProviderKey(db, "anthropic")) ?? undefined;
    const fullenrichKey = process.env.FULLENRICH_API_KEY;
    const bettercontactKey = process.env.BETTERCONTACT_API_KEY;
    const hasGoogle = Boolean(process.env.GOOGLE_PLACES_API_KEY);

    const crossCheck = (practiceId: string) =>
      crossCheckSignals({ db, meter, now, logger: console.warn }, practiceId);

    // Discovery is the paid Google source. Skip it (don't crash the whole run) when its creds are
    // absent. Its dep assembly is isolated too: a malformed tenant profile (once it becomes
    // DB-editable) must degrade to discovery-off, never sink the free detector sources.
    let discovery: RunDiscoveryDeps[] | null = null;
    if (anthropicApiKey && hasGoogle) {
      try {
        const tenant = getTenantProfile(DEFAULT_DISCOVERY_TENANT_ID);
        const metros = selectMetroBatch(
          tenant,
          now,
          resolveDiscoveryMetroLimit(request),
        );
        const discoveryLimit = resolveDiscoveryPerCategoryLimit(request);
        const reviewLimit = resolveDiscoveryReviewLimit(request);
        discovery = metros.map((metro) => ({
          ...buildLiveDiscoveryDeps({
            db,
            now,
            tenant,
            metro,
            meter,
            anthropicApiKey,
          }),
          limit: discoveryLimit,
          reviewLimit,
        }));
      } catch (err) {
        console.warn("engine.discovery.config_error", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // The downstream cascade needs Anthropic (extract + brief voice) plus the two-provider
    // trial enrichment stack: FullEnrich for people/email and BetterContact for email upgrade.
    // Prospeo and PDL are intentionally excluded from this production trial waterfall.
    const pipelineClients: PipelineClients | undefined =
      anthropicApiKey && fullenrichKey && bettercontactKey
        ? {
            scrape: (url: string) => scrapePractice({ fetch, lookup: dnsLookupAll }, url),
            extract: anthropicExtractClient(anthropicApiKey),
            fullenrichPeople: createFullEnrichClient({ apiKey: fullenrichKey }),
            fullenrichEmail: createFullEnrichClient({ apiKey: fullenrichKey }),
            bettercontact: createBetterContactClient({ apiKey: bettercontactKey }),
            voice: anthropicVoiceClient(anthropicApiKey),
            // Plan B website lookup — only when Google is available; metered per practice.
            resolveWebsite: hasGoogle
              ? (p) => resolvePracticeWebsite({ meter, practiceId: p.id }, p)
              : undefined,
            // agentic escalation OFF — cost discipline (matches scripts/run-pipeline.ts).
          }
        : undefined;
    const params = new URL(request.url).searchParams;
    const briefLimit = pipelineClients ? resolveBriefLimit(request) : 0;
    const force = params.get("force") === "1";
    const enrichOnly = params.get("enrichOnly") === "1";
    const downstreamCohort = resolveDownstreamCohort(request);

    const summary = await runEngine({
      db,
      meter,
      now,
      detectors: detectorRegistry,
      discovery,
      crossCheck,
      crossCheckLimit: briefLimit,
      pipelineClients,
      briefLimit,
      enrichOnly,
      downstreamCohort,
      force,
    });

    return NextResponse.json(summary);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    // error-level (not warn): this is the revenue cron failing to run at all, the exact
    // signal a log-based alert should page on (COV-06). Structured for a log drain.
    console.error("engine.run.setup_error", { error, ranAt: new Date().toISOString() });
    return NextResponse.json(
      { ran: false, stage: "setup", error },
      { status: 500 },
    );
  }
}
