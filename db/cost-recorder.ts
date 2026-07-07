import type { Database } from "./types";
import { costEvents } from "./schema";
import type { CostEventRecord, CostRecorder } from "@/src/roi/cost-meter";

/**
 * DB-backed CostRecorder — the production binding for the cost meter (R19).
 * Kept out of `src/roi/cost-meter.ts` so the meter itself stays DB-free and
 * unit-testable. numeric columns are written as strings (postgres numeric).
 */
export function drizzleCostRecorder(db: Database): CostRecorder {
  return {
    async record(row: CostEventRecord): Promise<void> {
      await db.insert(costEvents).values({
        provider: row.provider,
        operation: row.operation,
        pipelineStep: row.pipelineStep,
        practiceId: row.practiceId ?? null,
        units: String(row.units),
        unitCostUsd: String(row.unitCostUsd),
        costUsd: String(row.costUsd),
        meta: row.meta ?? null,
      });
    },
  };
}
