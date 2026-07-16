import { runLeadToBrief, type Lead, type PipelineDeps, type PipelineResult } from "./pipeline";

/**
 * The batch driver (U6) — run a cohort of leads through the conductor with ERROR ISOLATION,
 * exactly the shape `jobs/run-detectors.ts` uses: one lead's throw is logged and skipped, it
 * NEVER kills the run, and the rollup reports every outcome honestly. Pure of I/O beyond what
 * the injected conductor deps do, so it tests without a CLI.
 *
 * The conductor already folds each stage's SOFT failures into `PipelineResult` (a thin scrape
 * or a failed synthesis is a `failed`/`skipped` status, not a throw); this catch is the net for
 * a HARD failure (a dead DB, an un-guarded client error) so the other practices still get briefed.
 */

export interface BatchItem {
  /** null only when resolve never returned — i.e. the lead threw before a practice existed. */
  practiceId: string | null;
  name: string;
  status:
    | "enriched"
    | "briefed"
    | "skipped"
    | "failed"
    | "errored"
    | "deferred";
  result?: PipelineResult;
  error?: string;
}

export interface BatchSummary {
  /** Leads actually passed to the conductor. */
  total: number;
  enriched: number;
  briefed: number;
  skipped: number;
  failed: number;
  errored: number;
  /** All deadline deferrals, retained for compatibility. */
  deferred: number;
  /** Selected leads not started, before any provider spend. */
  deferredBeforeSpend: number;
  /** Attempted leads enriched in this invocation but deferred before voice synthesis. */
  deferredAfterEnrichment: number;
  items: BatchItem[];
}

function defaultLogger(event: string, meta?: Record<string, unknown>): void {
  console.warn(event, meta ?? {});
}

export async function runPipelineBatch(
  deps: PipelineDeps,
  leads: readonly Lead[],
  logger: (event: string, meta?: Record<string, unknown>) => void = defaultLogger,
  canStartLead: () => boolean = () => true,
): Promise<BatchSummary> {
  const items: BatchItem[] = [];
  let unstarted = 0;

  for (let index = 0; index < leads.length; index += 1) {
    const lead = leads[index];
    if (!canStartLead()) {
      unstarted = leads.length - index;
      logger("pipeline.batch_deferred", {
        deferred: unstarted,
        nextPractice: lead.name,
      });
      break;
    }
    try {
      const result = await runLeadToBrief(deps, lead);
      items.push({
        practiceId: result.practiceId,
        name: lead.name,
        status: result.status,
        result,
      });
    } catch (err) {
      // Error isolation (R3/R7 shape): a thrown lead is logged and skipped, never fatal.
      const error = err instanceof Error ? err.message : String(err);
      logger("pipeline.batch_error", { practice: lead.name, error });
      items.push({ practiceId: null, name: lead.name, status: "errored", error });
    }
  }

  const count = (status: BatchItem["status"]): number =>
    items.filter((item) => item.status === status).length;
  const deferredAfterEnrichment = items.filter(
    (item) => item.status === "deferred" && Boolean(item.result?.enrich),
  ).length;
  const deferredWithoutCurrentSpend =
    count("deferred") - deferredAfterEnrichment;

  return {
    total: items.length,
    enriched: count("enriched"),
    briefed: count("briefed"),
    skipped: count("skipped"),
    failed: count("failed"),
    errored: count("errored"),
    deferred: count("deferred") + unstarted,
    deferredBeforeSpend: unstarted + deferredWithoutCurrentSpend,
    deferredAfterEnrichment,
    items,
  };
}
