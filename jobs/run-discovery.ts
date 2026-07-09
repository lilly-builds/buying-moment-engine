import type { Database } from "@/db/types";
import { createMeter, type Meter } from "@/src/roi/cost-meter";
import { drizzleCostRecorder } from "@/db/cost-recorder";
import {
  isPlaceFresh,
  upsertDiscoveryCandidate,
  type DiscoveryVerdict,
} from "@/db/discovery";
import {
  attachSignal,
  resolvePractice,
  tagVertical,
} from "@/src/engine/resolver";
import { computeExpiresAt } from "@/src/engine/freshness";
import {
  fetchPlacesTextSearch,
  GOOGLE_TEXT_SEARCH_UNIT_COST_USD,
  metroToGeoKey,
  normalizeTextSearchResponse,
  passesRatingFunnel,
  textSearchResponseSchema,
  type FetchTextSearchFn,
  type PlaceCandidate,
} from "@/src/discovery/places-search";
import {
  fetchGooglePlaceDetails,
  googlePlaceDetailsResponseSchema,
  type FetchPlaceDetailsFn,
} from "@/src/detectors/phone-complaints-google-places";
import {
  anthropicClassifyClient,
  runClassify,
  type ClassifyClient,
} from "@/src/discovery/classify";
import {
  DEFAULT_CONFIDENCE_FLOOR,
  DEFAULT_PER_CATEGORY_LIMIT,
  DISCOVERY_PROVIDER_GOOGLE,
  GOOGLE_PLACE_DETAILS_UNIT_COST_USD,
  PIPELINE_STEP_DISCOVERY_DETAILS,
  PIPELINE_STEP_DISCOVERY_SEARCH,
} from "@/src/discovery/config";
import type { TenantProfile } from "@/src/discovery/tenants";
import type { PackVertical } from "@/src/packs";

/**
 * Discovery orchestration core (U5) — the one place enumerate -> funnel -> cache ->
 * Details+reviews -> LLM-qualify -> promote/archive is tied together, reusing the
 * engine's existing spine (`resolvePractice`/`attachSignal`, the freshness helper,
 * the cost meter). It is the discovery analogue of `runDetectors` (`jobs/run-detectors.ts`):
 *
 *  - PURE core with everything injected (db, meter, clock, clients, tenant) so it
 *    unit-tests against real PGlite + fake fetchers with no network — mirroring the
 *    core+wrapper split that keeps `next build` keyless.
 *  - ERROR-ISOLATED: one bad place (a Details fetch that throws, a malformed body)
 *    is logged and skipped; the run continues and the summary marks it. One flaky
 *    place never sinks the run.
 *  - EVERY paid call routes through `ctx.meter` (R6/R19): Text Search, Place
 *    Details, and each LLM classify. Discovery runs BEFORE a practice exists, so
 *    those rows carry `practiceId: null` by design.
 *
 * Why a job, not a `Detector`: `Detector.detect(ctx)` gets no DB, and the framework
 * models signal-against-known-practice; discovery must write the archive/cache
 * table and enumerate NEW practices (K1).
 *
 * Google ToS (R5/K4): review text is sent to the qualifier transiently, in memory.
 * Nothing persisted here holds it — the emitted evidence carries only the place's
 * Maps URL (no snippet), and `discovery_candidates` has no review-text column.
 */

export interface RunDiscoveryDeps {
  db: Database;
  meter: Meter;
  /** Injected clock so runs are reproducible. */
  now: Date;
  tenant: TenantProfile;
  /** This run's metro (the job wrapper picks it via rotation, U6). */
  metro: string;
  searchFetcher: FetchTextSearchFn;
  detailsFetcher: FetchPlaceDetailsFn;
  classifyClient: ClassifyClient;
  /** Max places to consider per ICP category (bounds spend). */
  limit?: number;
  /** A review qualifies only at/above this confidence (default DEFAULT_CONFIDENCE_FLOOR). */
  confidenceFloor?: number;
  logger?: (event: string, meta?: Record<string, unknown>) => void;
}

export interface QualifiedPlace {
  placeId: string;
  practiceHint: string;
  practiceId: string;
  category: string;
  confidence: number;
}

export interface DiscoverySummary {
  ran: true;
  tenantId: string;
  metro: string;
  geoKey: string;
  startedAt: string;
  finishedAt: string;
  /** Places seen from Text Search across all ICP categories. */
  enumerated: number;
  /** Dropped by the rating funnel before the expensive step. */
  funneledOut: number;
  /** Skipped by the re-pull cache. */
  cached: number;
  /** Places that reached Details+LLM. */
  checked: number;
  /** Places that emitted a signal onto the feed. */
  qualified: number;
  /** Places retained as not-targeted or checked-no-signal. */
  archived: number;
  /** Places whose processing threw and were isolated. */
  errored: number;
  /** Paid-call counts — every one wrote a cost_events row (USD lives in that ledger). */
  calls: { search: number; details: number; classify: number };
  qualifiedPlaces: QualifiedPlace[];
}

function defaultLogger(event: string, meta?: Record<string, unknown>): void {
  console.warn(event, meta ?? {});
}

/** "Austin, TX" -> { city: "Austin", state: "TX" } for the resolved practice row. */
function splitMetro(metro: string): { city: string | null; state: string | null } {
  const [city, state] = metro.split(",").map((part) => part.trim());
  return { city: city || null, state: state || null };
}

function mapsUrl(placeId: string, url?: string): string {
  return url ?? `https://www.google.com/maps/place/?q=place_id:${placeId}`;
}

export async function runDiscovery(deps: RunDiscoveryDeps): Promise<DiscoverySummary> {
  const { db, meter, now, tenant, metro } = deps;
  const log = deps.logger ?? defaultLogger;
  const limit = deps.limit ?? DEFAULT_PER_CATEGORY_LIMIT;
  const confidenceFloor = deps.confidenceFloor ?? DEFAULT_CONFIDENCE_FLOOR;
  const geoKey = metroToGeoKey(metro);
  const { city, state } = splitMetro(metro);

  const summary: DiscoverySummary = {
    ran: true,
    tenantId: tenant.id,
    metro,
    geoKey,
    startedAt: now.toISOString(),
    finishedAt: now.toISOString(),
    enumerated: 0,
    funneledOut: 0,
    cached: 0,
    checked: 0,
    qualified: 0,
    archived: 0,
    errored: 0,
    calls: { search: 0, details: 0, classify: 0 },
    qualifiedPlaces: [],
  };

  /** Retain a place in the archive/cache lane with its latest verdict. */
  async function archive(
    candidate: PlaceCandidate,
    vertical: PackVertical,
    verdict: DiscoveryVerdict,
    pulled: boolean,
    qualifiedKind: string | null,
  ): Promise<void> {
    await upsertDiscoveryCandidate(db, {
      placeId: candidate.placeId,
      tenantId: tenant.id,
      name: candidate.practiceHint,
      geoKey: candidate.geoKey,
      vertical,
      rating: candidate.rating,
      reviewCount: candidate.reviewCount,
      lastPulledAt: pulled ? now : null,
      lastVerdict: verdict,
      qualifiedKind,
      detectedAt: now,
    });
  }

  async function processCandidate(
    candidate: PlaceCandidate,
    vertical: PackVertical,
  ): Promise<void> {
    // 1. Rating funnel — nearly free, gates the expensive step (K6/R2).
    if (!passesRatingFunnel(candidate, tenant.ratingThreshold)) {
      await archive(candidate, vertical, "not-targeted", false, null);
      summary.funneledOut += 1;
      summary.archived += 1;
      return;
    }

    // 2. Re-pull cache — skip Details+LLM for a place pulled within the window (R7).
    if (await isPlaceFresh(db, candidate.placeId, now, tenant.rePullWindowDays)) {
      summary.cached += 1;
      return;
    }

    // 3. Place Details + reviews (the ~4¢ SKU) — metered.
    summary.checked += 1;
    summary.calls.details += 1;
    const detailsRaw = await meter(
      {
        provider: DISCOVERY_PROVIDER_GOOGLE,
        operation: "details",
        pipelineStep: PIPELINE_STEP_DISCOVERY_DETAILS,
        practiceId: null,
        units: 1,
        unitCostUsd: GOOGLE_PLACE_DETAILS_UNIT_COST_USD,
      },
      () =>
        deps.detailsFetcher({
          practiceHint: candidate.practiceHint,
          placeId: candidate.placeId,
          geoKey: candidate.geoKey,
        }),
    );

    const parsed = googlePlaceDetailsResponseSchema.safeParse(detailsRaw);
    if (!parsed.success || parsed.data.status !== "OK" || !parsed.data.result) {
      log("discovery.details.unusable", {
        placeId: candidate.placeId,
        status: parsed.success ? parsed.data.status : "PARSE_FAILED",
      });
      await archive(candidate, vertical, "checked-no-signal", true, null);
      summary.archived += 1;
      return;
    }

    // 4. Qualify each review IN MEMORY against the tenant criterion (R3). A place
    //    qualifies if any review qualifies at/above the confidence floor; keep the
    //    strongest verdict's category for the citation.
    const reviews = parsed.data.result.reviews ?? [];
    let qualifies = false;
    let bestConfidence = 0;
    let bestCategory = "";
    for (const review of reviews) {
      summary.calls.classify += 1;
      const outcome = await runClassify(
        { client: deps.classifyClient, meter, practiceId: null },
        { qualificationPrompt: tenant.qualificationPrompt, reviewText: review.text },
      );
      if (!outcome.ok) {
        log("discovery.classify.failed", { placeId: candidate.placeId, reason: outcome.reason });
        continue;
      }
      if (outcome.result.qualifies && outcome.result.confidence >= confidenceFloor) {
        qualifies = true;
        if (outcome.result.confidence > bestConfidence) {
          bestConfidence = outcome.result.confidence;
          bestCategory = outcome.result.category;
        }
      }
    }

    // 5a. No qualifying review — archive, retained for a later resurface (R7).
    if (!qualifies) {
      await archive(candidate, vertical, "checked-no-signal", true, null);
      summary.archived += 1;
      return;
    }

    // 5b. Qualified — land a signal on the existing feed via the resolver spine (R4).
    const resolved = await resolvePractice(db, {
      name: candidate.practiceHint,
      geoKey: candidate.geoKey,
      city,
      state,
      vertical,
    });
    // Tighten an `unclassified` practice we merged into (e.g. an Adzuna row) to the
    // ICP vertical, so the stacked practice stays feed-reachable (K7).
    await tagVertical(db, resolved.practiceId, vertical);

    const expiresAt = computeExpiresAt(tenant.signalKind, now);
    await attachSignal(db, {
      practiceId: resolved.practiceId,
      kind: tenant.signalKind,
      // R5 citation: the place's public Maps URL, never a word of review text.
      sourceUrl: mapsUrl(candidate.placeId, parsed.data.result.url),
      snippet: null,
      confidence: bestConfidence,
      detectedAt: now,
      expiresAt,
      signalSource: `discovery:${tenant.id}`,
    });

    await archive(candidate, vertical, "qualified", true, tenant.signalKind);
    summary.qualified += 1;
    summary.qualifiedPlaces.push({
      placeId: candidate.placeId,
      practiceHint: candidate.practiceHint,
      practiceId: resolved.practiceId,
      category: bestCategory,
      confidence: bestConfidence,
    });
  }

  for (const icp of tenant.icp) {
    // Enumerate this category in the metro — one metered Text Search call.
    let raw: unknown;
    try {
      summary.calls.search += 1;
      raw = await meter(
        {
          provider: DISCOVERY_PROVIDER_GOOGLE,
          operation: "textsearch",
          pipelineStep: PIPELINE_STEP_DISCOVERY_SEARCH,
          practiceId: null,
          units: 1,
          unitCostUsd: GOOGLE_TEXT_SEARCH_UNIT_COST_USD,
        },
        () => deps.searchFetcher({ category: icp.category, metro, geoKey }),
      );
    } catch (err) {
      summary.errored += 1;
      log("discovery.search.error", {
        metro,
        category: icp.category,
        error: err instanceof Error ? err.message : String(err),
      });
      continue;
    }

    const parsed = textSearchResponseSchema.safeParse(raw);
    if (!parsed.success) {
      log("discovery.search.malformed", { metro, category: icp.category });
      continue;
    }

    const candidates = normalizeTextSearchResponse(parsed.data, {
      category: icp.category,
      metro,
      geoKey,
    }).slice(0, limit);

    for (const candidate of candidates) {
      summary.enumerated += 1;
      try {
        await processCandidate(candidate, icp.vertical);
      } catch (err) {
        // Per-place error isolation: one bad place never sinks the run.
        summary.errored += 1;
        log("discovery.place.error", {
          placeId: candidate.placeId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  summary.finishedAt = new Date().toISOString();
  return summary;
}

/**
 * Build the LIVE production deps: real fetchers, the real classify client, and a
 * meter bound to the DB-backed cost recorder so every paid call persists a
 * `cost_events` row (R19). Reused by the scheduled job (U6) and the live probe
 * (U7). `ANTHROPIC_API_KEY` is read here, at call time, so import stays keyless.
 */
export function buildLiveDiscoveryDeps(params: {
  db: Database;
  now: Date;
  tenant: TenantProfile;
  metro: string;
  limit?: number;
  confidenceFloor?: number;
  meter?: Meter;
  logger?: (event: string, meta?: Record<string, unknown>) => void;
}): RunDiscoveryDeps {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY not configured — live discovery requires credentials",
    );
  }
  return {
    db: params.db,
    now: params.now,
    tenant: params.tenant,
    metro: params.metro,
    limit: params.limit,
    confidenceFloor: params.confidenceFloor,
    logger: params.logger,
    meter: params.meter ?? createMeter(drizzleCostRecorder(params.db)),
    searchFetcher: fetchPlacesTextSearch,
    detailsFetcher: fetchGooglePlaceDetails,
    classifyClient: anthropicClassifyClient(apiKey),
  };
}
