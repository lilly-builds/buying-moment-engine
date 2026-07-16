import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { drizzleCostRecorder } from "@/db/cost-recorder";
import {
  completeEngineRun,
  claimEngineRun,
  failEngineRun,
  reconcileStaleEngineRuns,
} from "@/db/engine-runs";
import { detectorRegistry } from "@/jobs/run-detectors";
import {
  buildLiveDiscoveryDeps,
  DEFAULT_DISCOVERY_TENANT_ID,
  type RunDiscoveryDeps,
} from "@/jobs/run-discovery";
import {
  runEngine,
  type EnginePhase,
  type PipelineClients,
} from "@/jobs/run-engine";
import { anthropicVoiceClient } from "@/src/brief/voice";
import { selectMetroBatch } from "@/src/discovery/rotation";
import { getTenantProfile } from "@/src/discovery/tenants";
import { crossCheckSignals } from "@/src/engine/cross-check";
import { createBetterContactClient } from "@/src/enrich/bettercontact-client";
import { anthropicExtractClient } from "@/src/enrich/extract";
import { createFullEnrichClient } from "@/src/enrich/fullenrich-client";
import { scrapePractice } from "@/src/enrich/scrape";
import { dnsLookupAll } from "@/src/enrich/url-guard";
import { resolvePracticeWebsite } from "@/src/enrich/website";
import { resolveProviderKey } from "@/src/keys/provider-keys";
import { createMeter } from "@/src/roi/cost-meter";
import {
  createInvocationBudget,
  resolveDiscoveryMetroLimit,
  resolveDiscoveryPerCategoryLimit,
  resolveDiscoveryReviewLimit,
  resolveDownstreamCohort,
  resolveScheduledBriefLimit,
  SCHEDULED_CROSS_CHECK_LIMIT,
} from "./config";

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const actual = createHash("sha256")
    .update(request.headers.get("authorization") ?? "")
    .digest();
  const expected = createHash("sha256").update(`Bearer ${secret}`).digest();
  return timingSafeEqual(actual, expected);
}

export async function handleCronRequest(
  request: Request,
  phase: EnginePhase = "all",
): Promise<Response> {
  if (!authorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (phase === "all") {
    return NextResponse.json(
      {
        ran: false,
        reason:
          "the combined run is disabled because source collection and downstream conversion cannot safely share one invocation; call /sources and /downstream separately",
      },
      { status: 409 },
    );
  }

  const budget = createInvocationBudget();
  let db: ReturnType<typeof getDb> | null = null;
  let runId: string | null = null;

  try {
    const activeDb = getDb();
    db = activeDb;
    const reconciledRuns = await reconcileStaleEngineRuns(activeDb);
    if (reconciledRuns > 0) {
      console.warn("engine.runs.reconciled", { count: reconciledRuns });
    }
    runId = await claimEngineRun(activeDb, phase);
    if (!runId) {
      return NextResponse.json({
        ran: false,
        phase,
        reason: "another invocation for this phase is already running",
      });
    }
    const now = new Date();
    const meter = createMeter(drizzleCostRecorder(activeDb));

    const anthropicApiKey =
      (await resolveProviderKey(activeDb, "anthropic")) ?? undefined;
    const fullenrichKey = process.env.FULLENRICH_API_KEY;
    const bettercontactKey = process.env.BETTERCONTACT_API_KEY;
    const hasGoogle = Boolean(process.env.GOOGLE_PLACES_API_KEY);

    const crossCheck = (practiceId: string) =>
      crossCheckSignals(
        { db: activeDb, meter, now, logger: console.warn },
        practiceId,
      );

    let discovery: RunDiscoveryDeps[] | null = null;
    let discoverySkipReason: string | undefined;
    if (phase !== "downstream" && anthropicApiKey && hasGoogle) {
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
            db: activeDb,
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
        discoverySkipReason = `discovery configuration error: ${
          err instanceof Error ? err.message : String(err)
        }`;
        console.warn("engine.discovery.config_error", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const pipelineClients: PipelineClients | undefined =
      phase !== "sources" &&
      anthropicApiKey &&
      fullenrichKey &&
      bettercontactKey
        ? {
            scrape: (url: string) =>
              scrapePractice({ fetch, lookup: dnsLookupAll }, url),
            extract: anthropicExtractClient(anthropicApiKey),
            fullenrichPeople: createFullEnrichClient({ apiKey: fullenrichKey }),
            fullenrichEmail: createFullEnrichClient({ apiKey: fullenrichKey }),
            bettercontact: createBetterContactClient({
              apiKey: bettercontactKey,
            }),
            voice: anthropicVoiceClient(anthropicApiKey),
            resolveWebsite: hasGoogle
              ? (practice) =>
                  resolvePracticeWebsite(
                    { meter, practiceId: practice.id },
                    practice,
                  )
              : undefined,
          }
        : undefined;

    const params = new URL(request.url).searchParams;
    const briefLimit = resolveScheduledBriefLimit(
      request,
      phase,
      Boolean(pipelineClients),
    );
    const summary = await runEngine({
      db: activeDb,
      meter,
      now,
      detectors: detectorRegistry,
      discovery,
      discoverySkipReason,
      crossCheck,
      crossCheckLimit: SCHEDULED_CROSS_CHECK_LIMIT,
      pipelineClients,
      briefLimit,
      enrichOnly: params.get("enrichOnly") === "1",
      downstreamCohort: resolveDownstreamCohort(request),
      force: params.get("force") === "1",
      phase,
      canStartLead: budget.canStartLead,
      canStartVoiceAttempt: budget.canStartVoiceAttempt,
    });

    await completeEngineRun(activeDb, runId, summary);
    return NextResponse.json(summary);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    if (db && runId) {
      try {
        await failEngineRun(db, runId, error);
      } catch (persistErr) {
        console.error("engine.run.persist_error", {
          runId,
          error:
            persistErr instanceof Error
              ? persistErr.message
              : String(persistErr),
        });
      }
    }
    console.error("engine.run.setup_error", {
      error,
      ranAt: new Date().toISOString(),
    });
    return NextResponse.json(
      { ran: false, stage: "setup", error },
      { status: 500 },
    );
  }
}
