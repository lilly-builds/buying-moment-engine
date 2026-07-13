import { and, eq } from "drizzle-orm";
import {
  freshSignalCheck,
  upsertSignalCheck,
  type SignalCheckStatus,
} from "@/db/queries";
import { discoveryCandidates, practices, signals } from "@/db/schema";
import type { Database } from "@/db/types";
import {
  ADZUNA_UNIT_COST_USD,
  adzunaSearchResponseSchema,
  fetchAdzunaJobs,
  normalizeJobToCandidate,
  type FetchJobsFn,
} from "@/src/detectors/staffing-spike-adzuna";
import {
  GDELT_UNIT_COST_USD,
  fetchGdeltArticles,
  gdeltSearchResponseSchema,
  normalizeArticleToCandidate,
  type FetchArticlesFn,
} from "@/src/detectors/growth-events-gdelt";
import {
  GOOGLE_PLACES_UNIT_COST_USD,
  fetchGooglePlaceDetails,
  googlePlaceDetailsResponseSchema,
  normalizePlaceReviewsToCandidate,
  type FetchPlaceDetailsFn,
} from "@/src/detectors/phone-complaints-google-places";
import type { SignalCandidate } from "@/src/engine/detector";
import type { DetectorKind } from "@/src/ingest/validate";
import type { Meter } from "@/src/roi/cost-meter";
import { computeExpiresAt, isFresh } from "./freshness";
import { attachSignal, nameSimilarity, normalizeGeoKey } from "./resolver";

/**
 * Proactive signal cross-check (Thread 08/17): once a practice is qualified by
 * any source, query the other sources for THAT known clinic and attach any real,
 * cited signals that fire. Bounded by practice id, metered at the source call,
 * audit-cached in `signal_checks`, and idempotent through attachSignal's citation
 * dedupe.
 */

const MATCH_THRESHOLD = 0.6;
const COOLDOWN_DAYS: Record<DetectorKind, number> = {
  staffing_spike: 14,
  growth_events: 7,
  phone_complaints: 30,
  regulation: 30,
};

export interface CrossCheckDeps {
  db: Database;
  meter: Meter;
  now: Date;
  fetchJobs?: FetchJobsFn;
  fetchArticles?: FetchArticlesFn;
  fetchPlaceDetails?: FetchPlaceDetailsFn;
  logger?: (event: string, meta?: Record<string, unknown>) => void;
}

export interface CrossCheckSummary {
  practiceId: string;
  practiceName: string;
  checked: DetectorKind[];
  attached: DetectorKind[];
  skipped: { kind: DetectorKind; reason: string }[];
}

function defaultLogger(event: string, meta?: Record<string, unknown>): void {
  console.warn(event, meta ?? {});
}

function quote(value: string): string {
  return `"${value.replace(/"/g, "")}"`;
}

function practiceWhere(practice: {
  city: string | null;
  state: string | null;
  geoKey: string;
}): string | undefined {
  if (practice.city && practice.state)
    return `${practice.city}, ${practice.state}`;
  return undefined;
}

function cooldownExpiresAt(kind: DetectorKind, now: Date): Date {
  return new Date(now.getTime() + COOLDOWN_DAYS[kind] * 24 * 60 * 60 * 1000);
}

async function existingKinds(
  db: Database,
  practiceId: string,
  now: Date,
): Promise<Set<DetectorKind>> {
  const rows = await db
    .select({ kind: signals.kind, expiresAt: signals.expiresAt })
    .from(signals)
    .where(eq(signals.practiceId, practiceId));
  return new Set(
    rows
      .filter((row) => isFresh(row.expiresAt, now))
      .map((row) => row.kind),
  );
}

function candidateMatchesPractice(
  candidate: SignalCandidate,
  practiceName: string,
): boolean {
  return (
    nameSimilarity(candidate.practiceHint, practiceName) >= MATCH_THRESHOLD
  );
}

function textMentionsPractice(text: string, practiceName: string): boolean {
  return text.toLowerCase().includes(practiceName.toLowerCase());
}

export async function crossCheckSignals(
  deps: CrossCheckDeps,
  practiceId: string,
): Promise<CrossCheckSummary> {
  const log = deps.logger ?? defaultLogger;
  const fetchJobs = deps.fetchJobs ?? fetchAdzunaJobs;
  const fetchArticles = deps.fetchArticles ?? fetchGdeltArticles;
  const fetchPlaceDetails = deps.fetchPlaceDetails ?? fetchGooglePlaceDetails;

  const [practice] = await deps.db
    .select()
    .from(practices)
    .where(eq(practices.id, practiceId))
    .limit(1);
  if (!practice) throw new Error(`practice not found: ${practiceId}`);

  const summary: CrossCheckSummary = {
    practiceId,
    practiceName: practice.name,
    checked: [],
    attached: [],
    skipped: [],
  };
  const kinds = await existingKinds(deps.db, practiceId, deps.now);

  async function record(
    kind: DetectorKind,
    provider: string,
    status: SignalCheckStatus,
    details: {
      costUsd?: number | null;
      evidenceId?: string | null;
      matchedPracticeName?: string | null;
      matchConfidence?: number | null;
      reason?: string | null;
    } = {},
  ) {
    await upsertSignalCheck(deps.db, {
      practiceId,
      kind,
      provider,
      status,
      checkedAt: deps.now,
      cooldownExpiresAt: cooldownExpiresAt(kind, deps.now),
      ...details,
    });
  }

  async function recentlyChecked(
    kind: DetectorKind,
    provider: string,
  ): Promise<boolean> {
    const row = await freshSignalCheck(deps.db, {
      practiceId,
      kind,
      provider,
      now: deps.now,
    });
    if (!row) return false;
    summary.skipped.push({ kind, reason: `fresh-check:${row.status}` });
    return true;
  }

  async function attach(kind: DetectorKind, candidate: SignalCandidate) {
    let evidenceId: string | null = null;
    for (const atom of candidate.evidence) {
      const signal = await attachSignal(deps.db, {
        practiceId,
        kind,
        sourceUrl: atom.sourceUrl,
        snippet: atom.snippet ?? null,
        confidence: atom.confidence ?? candidate.confidence,
        detectedAt: candidate.detectedAt,
        expiresAt: computeExpiresAt(kind, candidate.detectedAt),
        signalSource: `crosscheck:${kind}`,
        refresh: true,
      });
      evidenceId = signal.evidenceId;
    }
    if (!summary.attached.includes(kind)) summary.attached.push(kind);
    return evidenceId;
  }

  // Staffing: paid/free-tier Adzuna search scoped by the known clinic name + metro.
  if (kinds.has("staffing_spike")) {
    await record("staffing_spike", "adzuna", "skipped", {
      reason: "already-present",
    });
    summary.skipped.push({ kind: "staffing_spike", reason: "already-present" });
  } else if (!(await recentlyChecked("staffing_spike", "adzuna"))) {
    summary.checked.push("staffing_spike");
    try {
      const raw = await deps.meter(
        {
          provider: "adzuna",
          operation: "jobs.search",
          pipelineStep: "cross-check",
          practiceId,
          units: 1,
          unitCostUsd: ADZUNA_UNIT_COST_USD,
          meta: {
            practiceName: practice.name,
            where: practiceWhere(practice) ?? null,
          },
        },
        () =>
          fetchJobs({
            what: practice.name,
            where: practiceWhere(practice),
            page: 1,
          }),
      );
      const parsed = adzunaSearchResponseSchema.safeParse(raw);
      if (!parsed.success) {
        await record("staffing_spike", "adzuna", "errored", {
          costUsd: ADZUNA_UNIT_COST_USD,
          reason: "malformed-response",
        });
        summary.skipped.push({
          kind: "staffing_spike",
          reason: "malformed-response",
        });
      } else {
        let sawCandidate = false;
        let attached = false;
        for (const job of parsed.data.results) {
          const candidate = normalizeJobToCandidate(job, deps.now);
          if (!candidate) continue;
          sawCandidate = true;
          const jobMentionsPractice = textMentionsPractice(
            `${job.title} ${job.description ?? ""}`,
            practice.name,
          );
          const employerMatches = candidateMatchesPractice(
            candidate,
            practice.name,
          );
          if (!jobMentionsPractice && !employerMatches) continue;
          candidate.practiceHint = practice.name;
          candidate.geoKey = normalizeGeoKey(practice.geoKey);
          const evidenceId = await attach("staffing_spike", candidate);
          await record("staffing_spike", "adzuna", "fired", {
            costUsd: ADZUNA_UNIT_COST_USD,
            evidenceId,
            matchedPracticeName: candidate.practiceHint,
            matchConfidence: employerMatches
              ? nameSimilarity(candidate.practiceHint, practice.name)
              : 1,
          });
          attached = true;
          break;
        }
        if (!attached) {
          const status: SignalCheckStatus = sawCandidate
            ? "skipped"
            : "checked_no_signal";
          await record("staffing_spike", "adzuna", status, {
            costUsd: ADZUNA_UNIT_COST_USD,
            reason: sawCandidate ? "weak-or-no-match" : "no-front-desk-job",
          });
          summary.skipped.push({
            kind: "staffing_spike",
            reason: sawCandidate ? "weak-or-no-match" : "no-front-desk-job",
          });
        }
      }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      log("crosscheck.staffing.error", { practiceId, error });
      await record("staffing_spike", "adzuna", "errored", { reason: error });
      summary.skipped.push({ kind: "staffing_spike", reason: "fetch-error" });
    }
  }

  // Growth: keyless GDELT search targeted to the known clinic name.
  if (kinds.has("growth_events")) {
    await record("growth_events", "gdelt", "skipped", {
      reason: "already-present",
    });
    summary.skipped.push({ kind: "growth_events", reason: "already-present" });
  } else if (!(await recentlyChecked("growth_events", "gdelt"))) {
    summary.checked.push("growth_events");
    try {
      const raw = await deps.meter(
        {
          provider: "gdelt",
          operation: "news.search",
          pipelineStep: "cross-check",
          practiceId,
          units: 1,
          unitCostUsd: GDELT_UNIT_COST_USD,
          meta: { practiceName: practice.name },
        },
        () =>
          fetchArticles({
            query: `${quote(practice.name)} (acquired OR acquisition OR "private equity" OR merger OR "opens new location" OR "opens second location" OR expansion OR "adds new provider" OR "welcomes new provider")`,
            maxRecords: 25,
          }),
      );
      const parsed = gdeltSearchResponseSchema.safeParse(raw);
      if (!parsed.success) {
        await record("growth_events", "gdelt", "errored", {
          costUsd: GDELT_UNIT_COST_USD,
          reason: "malformed-response",
        });
        summary.skipped.push({
          kind: "growth_events",
          reason: "malformed-response",
        });
      } else {
        let sawCandidate = false;
        let attached = false;
        for (const article of parsed.data.articles) {
          const candidate = normalizeArticleToCandidate(article, deps.now);
          if (!candidate) continue;
          sawCandidate = true;
          const articleText = `${article.title} ${article.description ?? ""}`;
          const articleMentionsPractice = textMentionsPractice(
            articleText,
            practice.name,
          );
          const namesMatch = candidateMatchesPractice(candidate, practice.name);
          if (!articleMentionsPractice && !namesMatch) continue;
          candidate.practiceHint = practice.name;
          candidate.geoKey = normalizeGeoKey(practice.geoKey);
          const evidenceId = await attach("growth_events", candidate);
          await record("growth_events", "gdelt", "fired", {
            costUsd: GDELT_UNIT_COST_USD,
            evidenceId,
            matchedPracticeName: candidate.practiceHint,
            matchConfidence: namesMatch
              ? nameSimilarity(candidate.practiceHint, practice.name)
              : 1,
          });
          attached = true;
          break;
        }
        if (!attached) {
          const status: SignalCheckStatus = sawCandidate
            ? "skipped"
            : "checked_no_signal";
          await record("growth_events", "gdelt", status, {
            costUsd: GDELT_UNIT_COST_USD,
            reason: sawCandidate ? "weak-or-no-match" : "no-growth-article",
          });
          summary.skipped.push({
            kind: "growth_events",
            reason: sawCandidate ? "weak-or-no-match" : "no-growth-article",
          });
        }
      }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      log("crosscheck.growth.error", { practiceId, error });
      await record("growth_events", "gdelt", "errored", { reason: error });
      summary.skipped.push({ kind: "growth_events", reason: "fetch-error" });
    }
  }

  // Phone complaints: only run when we already have a permitted Google place_id
  // for this same practice from the discovery archive/cache lane.
  if (kinds.has("phone_complaints")) {
    await record("phone_complaints", "google-places", "skipped", {
      reason: "already-present",
    });
    summary.skipped.push({
      kind: "phone_complaints",
      reason: "already-present",
    });
  } else if (!(await recentlyChecked("phone_complaints", "google-places"))) {
    const candidates = await deps.db
      .select()
      .from(discoveryCandidates)
      .where(
        and(
          eq(discoveryCandidates.geoKey, normalizeGeoKey(practice.geoKey)),
          eq(discoveryCandidates.lastVerdict, "qualified"),
        ),
      );
    const place = candidates.find(
      (candidate) =>
        nameSimilarity(candidate.name, practice.name) >= MATCH_THRESHOLD,
    );
    if (!place) {
      await record("phone_complaints", "google-places", "skipped", {
        reason: "no-known-place-id",
      });
      summary.skipped.push({
        kind: "phone_complaints",
        reason: "no-known-place-id",
      });
    } else {
      summary.checked.push("phone_complaints");
      try {
        const raw = await deps.meter(
          {
            provider: "google-places",
            operation: "place-details+reviews",
            pipelineStep: "cross-check",
            practiceId,
            units: 1,
            unitCostUsd: GOOGLE_PLACES_UNIT_COST_USD,
            meta: { placeId: place.placeId },
          },
          () =>
            fetchPlaceDetails({
              practiceHint: practice.name,
              placeId: place.placeId,
              geoKey: normalizeGeoKey(practice.geoKey),
            }),
        );
        const parsed = googlePlaceDetailsResponseSchema.safeParse(raw);
        if (!parsed.success) {
          await record("phone_complaints", "google-places", "errored", {
            costUsd: GOOGLE_PLACES_UNIT_COST_USD,
            reason: "malformed-response",
          });
          summary.skipped.push({
            kind: "phone_complaints",
            reason: "malformed-response",
          });
        } else {
          const candidate = normalizePlaceReviewsToCandidate(
            parsed.data,
            {
              practiceHint: practice.name,
              placeId: place.placeId,
              geoKey: normalizeGeoKey(practice.geoKey),
            },
            deps.now,
          );
          if (candidate) {
            const evidenceId = await attach("phone_complaints", candidate);
            await record("phone_complaints", "google-places", "fired", {
              costUsd: GOOGLE_PLACES_UNIT_COST_USD,
              evidenceId,
              matchedPracticeName: practice.name,
              matchConfidence: 1,
            });
          } else {
            await record(
              "phone_complaints",
              "google-places",
              "checked_no_signal",
              {
                costUsd: GOOGLE_PLACES_UNIT_COST_USD,
                reason: "no-phone-complaint",
              },
            );
            summary.skipped.push({
              kind: "phone_complaints",
              reason: "no-phone-complaint",
            });
          }
        }
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        log("crosscheck.phone.error", { practiceId, error });
        await record("phone_complaints", "google-places", "errored", {
          reason: error,
        });
        summary.skipped.push({
          kind: "phone_complaints",
          reason: "fetch-error",
        });
      }
    }
  }

  return summary;
}
