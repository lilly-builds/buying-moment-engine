import { inngest } from "./inngest";
import { getDb } from "@/db/client";
import { ingestRawSignal, type IngestResult } from "@/db/ingest";
import {
  candidateToRawSignals,
  type Detector,
  type DetectorContext,
} from "@/src/engine/detector";
import { computeExpiresAt } from "@/src/engine/freshness";
import type { DetectorKind } from "@/src/ingest/validate";
import type { Meter } from "@/src/roi/cost-meter";
import type { Database } from "@/db/types";

/**
 * Detector runner (R3/R7) — the error-isolated scheduler body. It runs each
 * detector, flattens its candidates to raw signals, and persists them through
 * the U1 ingest rail (dedupe + atomic promotion) with freshness threaded in.
 *
 * Error isolation is the framework's core promise: one detector throwing is
 * logged and the run continues with the others — a single flaky source never
 * takes down the whole cron. The registry + db + clock are injected so the core
 * unit-tests against real PGlite with no network.
 */

export interface RunDetectorsDeps {
  db: Database;
  detectors: Detector[];
  /** Injected clock so runs are reproducible (defaults to wall-clock). */
  now?: Date;
  /** Optional cost meter handed to each detector for its own paid fetches. */
  meter?: Meter;
  /** Freshness resolver; defaults to the per-kind windows in `freshness.ts`. */
  expiresAtFor?: (kind: DetectorKind, detectedAt: Date) => Date;
  /** Structured logger for isolated errors; defaults to `console.warn`. */
  logger?: (event: string, meta?: Record<string, unknown>) => void;
}

export interface DetectorReport {
  detector: string;
  kind: DetectorKind;
  status: "ok" | "errored";
  error?: string;
  candidates: number;
  ingested: number;
  duplicate: number;
  rejected: number;
}

export interface RunSummary {
  ran: true;
  startedAt: string;
  finishedAt: string;
  totals: {
    detectors: number;
    errored: number;
    ingested: number;
    duplicate: number;
    rejected: number;
  };
  reports: DetectorReport[];
}

function tally(report: DetectorReport, result: IngestResult): void {
  if (result.status === "ingested") report.ingested += 1;
  else if (result.status === "duplicate") report.duplicate += 1;
  else report.rejected += 1;
}

function defaultLogger(
  event: string,
  meta?: Record<string, unknown>,
): void {
  console.warn(event, meta ?? {});
}

/**
 * Run a set of detectors and persist their emissions. Returns a per-detector
 * summary (candidates + ingested/duplicate/rejected, or an errored verdict).
 */
export async function runDetectors(
  deps: RunDetectorsDeps,
): Promise<RunSummary> {
  const now = deps.now ?? new Date();
  const expiresAtFor = deps.expiresAtFor ?? computeExpiresAt;
  const log = deps.logger ?? defaultLogger;
  const ctx: DetectorContext = { now, meter: deps.meter };
  const startedAt = now.toISOString();
  const reports: DetectorReport[] = [];

  for (const detector of deps.detectors) {
    const report: DetectorReport = {
      detector: detector.name,
      kind: detector.kind,
      status: "ok",
      candidates: 0,
      ingested: 0,
      duplicate: 0,
      rejected: 0,
    };

    try {
      const candidates = await detector.detect(ctx);
      report.candidates = candidates.length;
      for (const candidate of candidates) {
        for (const raw of candidateToRawSignals(candidate)) {
          const result = await ingestRawSignal(deps.db, raw, {
            computeExpiresAt: expiresAtFor,
          });
          tally(report, result);
        }
      }
    } catch (err) {
      // Error isolation (R3/R7): a thrown detector NEVER kills the run.
      report.status = "errored";
      report.error = err instanceof Error ? err.message : String(err);
      log("detector.error", {
        detector: detector.name,
        kind: detector.kind,
        error: report.error,
      });
    }

    reports.push(report);
  }

  const totals = reports.reduce(
    (acc, r) => {
      acc.errored += r.status === "errored" ? 1 : 0;
      acc.ingested += r.ingested;
      acc.duplicate += r.duplicate;
      acc.rejected += r.rejected;
      return acc;
    },
    { detectors: reports.length, errored: 0, ingested: 0, duplicate: 0, rejected: 0 },
  );

  return {
    ran: true,
    startedAt,
    finishedAt: new Date().toISOString(),
    totals,
    reports,
  };
}

/**
 * Detector registry — U4 populates this with the real detectors. Kept empty here
 * so the framework + scheduler ship independently of the detectors themselves.
 */
export const detectorRegistry: Detector[] = [];

/**
 * Scheduled run (Inngest cron). Builds production deps lazily inside the handler
 * so import + `next build` stay keyless; only a live cron reads DATABASE_URL.
 */
export const runDetectorsJob = inngest.createFunction(
  { id: "run-detectors", triggers: [{ cron: "0 */6 * * *" }] },
  async () => {
    return runDetectors({ db: getDb(), detectors: detectorRegistry });
  },
);
