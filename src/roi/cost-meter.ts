/**
 * Cost meter (R19) — the single wrapper EVERY paid call routes through. It runs
 * the paid call, computes cost, and writes ONE cost_events row via an injected
 * recorder. The recorder is injected (not imported) so the meter unit-tests with
 * a fake recorder and no database. A paid call that skips this meter is a
 * review-blocking miss.
 */

export interface CostEventRecord {
  provider: string;
  operation: string;
  pipelineStep: string;
  practiceId?: string | null;
  units: number;
  unitCostUsd: number;
  costUsd: number;
  meta?: Record<string, unknown> | null;
}

export interface CostRecorder {
  record(row: CostEventRecord): Promise<void>;
}

export interface MeterParams {
  provider: string;
  operation: string;
  pipelineStep: string;
  practiceId?: string | null;
  units: number;
  unitCostUsd: number;
  meta?: Record<string, unknown> | null;
}

export type Meter = <T>(params: MeterParams, fn: () => Promise<T>) => Promise<T>;

/**
 * Bind a recorder and get back `meter(params, fn)`. On success it computes
 * `cost_usd = units * unit_cost_usd`, records one row, and returns fn's result.
 */
export function createMeter(recorder: CostRecorder): Meter {
  return async function meter<T>(
    params: MeterParams,
    fn: () => Promise<T>,
  ): Promise<T> {
    const result = await fn();
    const costUsd = params.units * params.unitCostUsd;
    await recorder.record({ ...params, costUsd });
    return result;
  };
}
