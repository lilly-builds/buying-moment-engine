import type { Database } from "@/db/types";
import type { Meter } from "@/src/roi/cost-meter";
import type { Detector } from "@/src/engine/detector";
import { runDetectors, type RunSummary } from "./run-detectors";
import {
  runDiscovery,
  type DiscoverySummary,
  type RunDiscoveryDeps,
} from "./run-discovery";
import { practicesNeedingBriefs } from "@/db/queries";
import { runPipelineBatch, type BatchSummary } from "@/src/engine/pipeline-batch";
import type { Lead, PipelineDeps } from "@/src/engine/pipeline";

/**
 * The engine heartbeat (Thread 06) — ONE scheduled run that fires every signal source at once,
 * then cascades the fresh leads downstream into cited briefs. This is the single orchestration
 * the Vercel Cron route (`app/api/cron/run-engine`) calls; it is the literal "constant flow"
 * (R1) made self-running — one trigger, all sources, the whole engine.
 *
 *   SOURCES (fan out)                       DOWNSTREAM (bounded cascade)
 *   ├─ detectors  (Adzuna · GDELT · Google)   practicesNeedingBriefs(limit)
 *   └─ discovery  (one rotated metro)      →  runPipelineBatch → enrich → synthesize → persist
 *
 * PROPERTIES (each already proven in the units this composes — nothing re-implemented here):
 *  - METERED (R19): ONE injected meter threads through every paid stage; the engine itself
 *    makes no paid call. This is what finally records SCHEDULED-run spend into `cost_events`.
 *  - IDEMPOTENT (R17/D13): resolve never duplicates; a practice with a current brief is skipped
 *    spending nothing; a missed or partial run self-heals on the next tick.
 *  - BOUNDED: `briefLimit` caps the downstream cohort so a run finishes inside Vercel's 300s
 *    function ceiling. The freshness windows (30–90d) mean the tail is picked up next run, so a
 *    bounded run is not a dropped lead — it is reconciliation over days (K: safe to miss).
 *  - ERROR-ISOLATED at every level: per-detector + per-place (the source runners), per-practice
 *    (the batch driver), and per-STAGE here — one stage's catastrophe never sinks the rest.
 *  - NOTHING SENDS (D9): the cascade ends at a persisted brief; no send path is wired in.
 *
 * Everything external is injected (db, meter, clients, clock) so it unit-tests against real
 * PGlite + fake fetchers with no network — the same core+wrapper split that keeps `next build`
 * keyless; only the live route reads env / DATABASE_URL.
 */

/** Default downstream cohort per run — small enough to finish well inside Vercel's 300s ceiling
 *  even when every lead needs an Opus brief; overridable via `ENGINE_BRIEF_LIMIT`. */
export const DEFAULT_ENGINE_BRIEF_LIMIT = 10;

/** The enrich + synthesize client bundle — everything `PipelineDeps` needs EXCEPT the shared
 *  db / meter / now / logger / force the engine threads in from one place. */
export type PipelineClients = Pick<
  PipelineDeps,
  "scrape" | "extract" | "pdl" | "voice" | "resolveWebsite" | "escalation"
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
  /** Downstream conductor clients (enrich → synthesize). Omit to skip the cascade — e.g. the
   *  enrichment/brief key is absent, so there is nothing to build a brief with. */
  pipelineClients?: PipelineClients;
  /**
   * Max practices to brief this run. Bounds wall-clock under Vercel's 300s ceiling; `0` skips
   * the downstream cascade entirely (as does omitting `pipelineClients`).
   */
  briefLimit: number;
  /** Regenerate already-briefed practices too (deliberate). Default false → skip briefed. */
  force?: boolean;
  logger?: (event: string, meta?: Record<string, unknown>) => void;
}

type Skipped = { skipped: true; reason: string };
type Errored = { errored: true; error: string };

export interface EngineRunSummary {
  ran: true;
  startedAt: string;
  finishedAt: string;
  briefLimit: number;
  sources: {
    detectors: RunSummary | Errored;
    discovery: DiscoverySummary | Skipped | Errored;
  };
  downstream: BatchSummary | Skipped | Errored;
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
export async function runEngine(deps: RunEngineDeps): Promise<EngineRunSummary> {
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
    ? await runStage("discovery", log, () => runDiscovery(deps.discovery as RunDiscoveryDeps))
    : { skipped: true, reason: "no discovery deps (missing Google Places / Anthropic key)" };

  // 2 — DOWNSTREAM CASCADE. The freshly-landed leads with no brief yet, bounded, through the
  //     conductor (resolve → website → enrich → synthesize → persist).
  let downstream: BatchSummary | Skipped | Errored;
  const clients = deps.pipelineClients;
  if (deps.briefLimit <= 0 || !clients) {
    downstream = {
      skipped: true,
      reason: !clients
        ? "no enrichment/brief clients (key absent)"
        : "briefLimit=0",
    };
  } else {
    downstream = await runStage("downstream", log, async () => {
      const pull = await practicesNeedingBriefs(deps.db, { limit: deps.briefLimit, now });
      if (pull.length === 0) {
        return { total: 0, briefed: 0, skipped: 0, failed: 0, errored: 0, items: [] };
      }
      const leads: Lead[] = pull.map((p) => ({
        name: p.name,
        geoKey: p.geoKey,
        city: p.city,
        state: p.state,
        websiteUrl: p.websiteUrl,
      }));
      const pipelineDeps: PipelineDeps = {
        db: deps.db,
        meter: deps.meter,
        now: () => now,
        logger: deps.logger,
        force: deps.force ?? false,
        ...clients,
      };
      return runPipelineBatch(pipelineDeps, leads, deps.logger);
    });
  }

  const finishedAt = new Date().toISOString();
  log("engine.run.complete", {
    startedAt,
    finishedAt,
    briefed: "briefed" in downstream ? downstream.briefed : null,
  });

  return {
    ran: true,
    startedAt,
    finishedAt,
    briefLimit: deps.briefLimit,
    sources: { detectors, discovery },
    downstream,
  };
}
