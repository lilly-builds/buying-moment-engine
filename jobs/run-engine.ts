import type { Database } from "@/db/types";
import type { Meter } from "@/src/roi/cost-meter";
import type { Detector } from "@/src/engine/detector";
import { runDetectors, type RunSummary } from "./run-detectors";
import {
  runDiscovery,
  type DiscoverySummary,
  type RunDiscoveryDeps,
} from "./run-discovery";
import {
  practicesNeedingBriefs,
  practicesNeedingCrossChecks,
} from "@/db/queries";
import {
  runPipelineBatch,
  type BatchSummary,
} from "@/src/engine/pipeline-batch";
import type { PipelineDeps } from "@/src/engine/pipeline";

/**
 * The engine heartbeat (Thread 06) — ONE scheduled run that fires every signal source at once,
 * then cascades the fresh leads downstream into cited briefs. This is the single orchestration
 * the Vercel Cron route (`app/api/cron/run-engine`) calls; it is the literal "constant flow"
 * (R1) made self-running — one trigger, all sources, the whole engine.
 *
 *   SOURCES (fan out)                       DOWNSTREAM (bounded cascade)
 *   ├─ detectors  (Adzuna · GDELT · Google)   practicesNeedingBriefs()
 *   └─ discovery  (one rotated metro)      →  runPipelineBatch → enrich → synthesize → persist
 *
 * PROPERTIES (each already proven in the units this composes — nothing re-implemented here):
 *  - METERED (R19): ONE injected meter threads through every paid stage; the engine itself
 *    makes no paid call. This is what finally records SCHEDULED-run spend into `cost_events`.
 *  - IDEMPOTENT (R17/D13): resolve never duplicates; a practice with a current brief is skipped
 *    spending nothing; a missed or partial run self-heals on the next tick.
 *  - BOUNDED BUT HONEST: `briefLimit` is only this invocation's operational batch size. The
 *    engine first counts every eligible unbriefed buying-moment lead, attempts a bounded slice,
 *    and reports what remains pending so unbriefed good leads are visible and picked up later.
 *  - ERROR-ISOLATED at every level: per-detector + per-place (the source runners), per-practice
 *    (the batch driver), and per-STAGE here — one stage's catastrophe never sinks the rest.
 *  - NOTHING SENDS (D9): the cascade ends at a persisted brief; no send path is wired in.
 *
 * Everything external is injected (db, meter, clients, clock) so it unit-tests against real
 * PGlite + fake fetchers with no network — the same core+wrapper split that keeps `next build`
 * keyless; only the live route reads env / DATABASE_URL.
 */

/** Default downstream batch per invocation. This is an operational safety bound, not product
 * eligibility: every eligible unbriefed lead is counted and pending leftovers are reported. */
export const DEFAULT_ENGINE_BRIEF_LIMIT = 50;

/** Hard ceiling on external brief-building calls in one invocation. A fat-fingered
 * `ENGINE_BRIEF_LIMIT` (e.g. `100000`) must not defeat the Vercel time/cost bound. */
export const MAX_ENGINE_BRIEF_LIMIT = 50;

/** The enrich + synthesize client bundle — everything `PipelineDeps` needs EXCEPT the shared
 *  db / meter / now / logger / force the engine threads in from one place. */
export type PipelineClients = Pick<
  PipelineDeps,
  | "scrape"
  | "extract"
  | "pdl"
  | "prospeo"
  | "fullenrichPeople"
  | "fullenrichEmail"
  | "bettercontact"
  | "voice"
  | "resolveWebsite"
  | "escalation"
>;

export interface RunEngineDeps {
  db: Database;
  /** ONE meter, threaded into every paid stage (R19). */
  meter: Meter;
  /** Injected clock so runs are reproducible (defaults to wall-clock). */
  now?: Date;
  /** The signal sources fired every run (the detector registry in prod). */
  detectors: Detector[];
  /**
   * This run's discovery deps (its single rotated metro, already assembled by the caller), or
   * `null` to skip discovery — e.g. its Google/Anthropic creds are absent. When present it MUST
   * share this run's `db` + `meter` + `now` so spend and timestamps stay consistent.
   */
  discovery: RunDiscoveryDeps | null;
  /** Optional proactive cross-check stage. Runs after sources and before brief selection. */
  crossCheck?: (practiceId: string) => Promise<unknown>;
  /** Max practices to cross-check this run. Defaults to the brief batch size, then the normal default. */
  crossCheckLimit?: number;
  /** Downstream conductor clients (enrich → synthesize). Omit to skip the cascade — e.g. the
   *  enrichment/brief key is absent, so there is nothing to build a brief with. */
  pipelineClients?: PipelineClients;
  /**
   * Max practices to attempt briefing in this invocation. This is operational batching only; `0`
   * is explicit briefing-disabled mode and pending eligible leads are reported.
   */
  briefLimit: number;
  /** Regenerate already-briefed practices too (deliberate). Default false → skip briefed. */
  force?: boolean;
  logger?: (event: string, meta?: Record<string, unknown>) => void;
}

type Skipped = { skipped: true; reason: string };
export type DownstreamSkipped = Skipped & {
  eligible: number;
  attempted: 0;
  briefed: 0;
  pending: number;
  skippedReasons: string[];
};
type Errored = { errored: true; error: string };

export interface CrossCheckRunSummary {
  ran: true;
  total: number;
  attached: number;
  skipped: number;
}

export interface EngineRunSummary {
  ran: true;
  startedAt: string;
  finishedAt: string;
  /** Back-compat name for the invocation batch size. */
  briefLimit: number;
  /** Operational batch size used for external brief-building calls this invocation. */
  briefBatchSize: number;
  sources: {
    detectors: RunSummary | Errored;
    discovery: DiscoverySummary | Skipped | Errored;
  };
  crossCheck: CrossCheckRunSummary | Skipped | Errored;
  downstream: DownstreamSummary | DownstreamSkipped | Errored;
}

export interface DownstreamSummary extends BatchSummary {
  /** Eligible unbriefed good leads found after source + cross-check stages. */
  eligible: number;
  /** Leads actually sent through the brief pipeline this invocation. Same as total. */
  attempted: number;
  /** Eligible leads still lacking a brief after this invocation. */
  pending: number;
  /** Human-readable reasons work did not happen for eligible leads. */
  skippedReasons: string[];
}

function defaultLogger(event: string, meta?: Record<string, unknown>): void {
  console.warn(event, meta ?? {});
}

/**
 * Run one stage with cross-stage error isolation: a HARD throw (a dead DB, an un-guarded client
 * error) is logged and folded into an `{errored}` marker so the OTHER stages + the downstream
 * cascade still run. The source runners and the batch driver already isolate their OWN soft
 * failures internally; this is the net for a whole-stage catastrophe.
 */
async function runStage<T>(
  name: string,
  log: (event: string, meta?: Record<string, unknown>) => void,
  fn: () => Promise<T>,
): Promise<T | Errored> {
  try {
    return await fn();
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    log("engine.stage_error", { stage: name, error });
    return { errored: true, error };
  }
}

/** Fire every signal source, then cascade the fresh cohort into cited briefs. */
export async function runEngine(
  deps: RunEngineDeps,
): Promise<EngineRunSummary> {
  const now = deps.now ?? new Date();
  const log = deps.logger ?? defaultLogger;
  const startedAt = now.toISOString();

  // 1 — SIGNAL SOURCES. Fan out to every source; each stage isolated so one flaky source never
  //     takes down the others or the cascade.
  const detectors = await runStage("detectors", log, () =>
    runDetectors({
      db: deps.db,
      detectors: deps.detectors,
      meter: deps.meter,
      now,
      logger: deps.logger,
    }),
  );

  const discovery: DiscoverySummary | Skipped | Errored = deps.discovery
    ? await runStage("discovery", log, () =>
        runDiscovery(deps.discovery as RunDiscoveryDeps),
      )
    : {
        skipped: true,
        reason: "no discovery deps (missing Google Places / Anthropic key)",
      };

  // 2 — PROACTIVE CROSS-CHECK. After all source stages have landed signals, but BEFORE the
  //     brief cohort is selected, check feed-eligible practices against the other signal
  //     families. This is the point where the brief can still see newly stacked signals.
  const crossCheck: CrossCheckRunSummary | Skipped | Errored = deps.crossCheck
    ? await runStage("cross-check", log, async () => {
        const limit =
          deps.crossCheckLimit ?? (deps.briefLimit > 0 ? deps.briefLimit : 0);
        if (limit <= 0) return { ran: true, total: 0, attached: 0, skipped: 0 };
        const cohort = await practicesNeedingCrossChecks(deps.db, {
          limit,
          now,
        });
        let attached = 0;
        let skipped = 0;
        for (const practice of cohort) {
          const result = await deps.crossCheck?.(practice.id);
          if (
            result &&
            typeof result === "object" &&
            "attached" in result &&
            Array.isArray((result as { attached: unknown }).attached)
          ) {
            attached += (result as { attached: unknown[] }).attached.length;
          }
          if (
            result &&
            typeof result === "object" &&
            "skipped" in result &&
            Array.isArray((result as { skipped: unknown }).skipped)
          ) {
            skipped += (result as { skipped: unknown[] }).skipped.length;
          }
        }
        return { ran: true, total: cohort.length, attached, skipped };
      })
    : { skipped: true, reason: "no cross-check deps" };

  // 3 — DOWNSTREAM CASCADE. Count every eligible unbriefed good lead first, then attempt only
  //     this invocation's bounded batch through the conductor. The bound protects time/cost; it
  //     must never hide the rest of the backlog.
  const clients = deps.pipelineClients;
  const downstream: DownstreamSummary | DownstreamSkipped | Errored =
    await runStage("downstream", log, async () => {
      const eligible = await practicesNeedingBriefs(deps.db, {
        now,
        includeBriefed: deps.force ?? false,
      });
      const eligibleCount = eligible.length;

      if (!clients || deps.briefLimit <= 0) {
        const reason = !clients
          ? "no coverage-first enrichment/brief clients (missing Anthropic/Prospeo/FullEnrich/BetterContact key)"
          : "briefing disabled (briefLimit=0)";
        return {
          skipped: true,
          reason,
          eligible: eligibleCount,
          attempted: 0,
          briefed: 0,
          pending: eligibleCount,
          skippedReasons: eligibleCount > 0 ? [reason] : [],
        };
      }

      const batch = eligible.slice(0, deps.briefLimit);
      const unattempted = Math.max(eligibleCount - batch.length, 0);
      const skippedReasons: string[] = [];
      if (unattempted > 0) {
        skippedReasons.push(
          `${unattempted} eligible lead(s) left pending by invocation batch size ${deps.briefLimit}`,
        );
      }

      const empty: BatchSummary = {
        total: 0,
        briefed: 0,
        skipped: 0,
        failed: 0,
        errored: 0,
        items: [],
      };
      const batchSummary =
        batch.length === 0
          ? empty
          : await runPipelineBatch(
              {
                db: deps.db,
                meter: deps.meter,
                now: () => now,
                logger: deps.logger,
                force: deps.force ?? false,
                ...clients,
              },
              batch.map((p) => ({
                name: p.name,
                geoKey: p.geoKey,
                city: p.city,
                state: p.state,
                websiteUrl: p.websiteUrl,
              })),
              deps.logger,
            );

      if (batchSummary.skipped > 0)
        skippedReasons.push("brief pipeline skipped attempted lead(s)");
      if (batchSummary.failed > 0)
        skippedReasons.push("brief pipeline failed attempted lead(s)");
      if (batchSummary.errored > 0)
        skippedReasons.push("brief pipeline errored attempted lead(s)");

      return {
        ...batchSummary,
        eligible: eligibleCount,
        attempted: batch.length,
        pending: Math.max(eligibleCount - batchSummary.briefed, 0),
        skippedReasons,
      };
    });

  const finishedAt = new Date().toISOString();
  log("engine.run.complete", {
    startedAt,
    finishedAt,
    briefed: "briefed" in downstream ? downstream.briefed : null,
    eligible: "eligible" in downstream ? downstream.eligible : null,
    attempted: "attempted" in downstream ? downstream.attempted : null,
    pending: "pending" in downstream ? downstream.pending : null,
  });

  return {
    ran: true,
    startedAt,
    finishedAt,
    briefLimit: deps.briefLimit,
    briefBatchSize: deps.briefLimit,
    sources: { detectors, discovery },
    crossCheck,
    downstream,
  };
}
