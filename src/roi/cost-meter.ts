/**
 * Cost meter (R19) — the single wrapper EVERY paid call routes through. It runs
 * the paid call, computes cost, and writes ONE cost_events row via an injected
 * recorder. The recorder is injected (not imported) so the meter unit-tests with
 * a fake recorder and no database. A paid call that skips this meter is a
 * review-blocking miss.
 *
 * `units` / `unitCostUsd` / `meta` accept either a literal or a RESOLVER that
 * reads the call's result. Some paid calls only price themselves once they
 * return: an Anthropic Messages call bills on the token counts in its own
 * `usage` block, and PDL bills per MATCHED record (a 404 no-match is free).
 * A literal-only signature would force those call sites to either guess a price
 * before the call or record outside the wrapper — both defeat R19. Existing
 * literal call sites are unchanged.
 */

/** A value known up front, or one derived from the paid call's result. */
export type MeterValue<T, V> = V | ((result: T) => V);

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

export interface MeterParams<T = unknown> {
  provider: string;
  operation: string;
  pipelineStep: string;
  practiceId?: string | null;
  units: MeterValue<T, number>;
  unitCostUsd: MeterValue<T, number>;
  meta?: MeterValue<T, Record<string, unknown> | null>;
}

export type Meter = <T>(
  params: MeterParams<T>,
  fn: () => Promise<T>,
) => Promise<T>;

function resolve<T, V>(value: MeterValue<T, V>, result: T): V {
  return typeof value === "function"
    ? (value as (r: T) => V)(result)
    : value;
}

/**
 * Bind a recorder and get back `meter(params, fn)`. On success it computes
 * `cost_usd = units * unit_cost_usd`, records one row, and returns fn's result.
 *
 * A THROWN paid call records nothing — deliberately. A failed HTTP call is an
 * uncharged call (PDL bills matched records; Anthropic bills a completed
 * request), so writing a cost row for it would inflate measured CAC with money
 * nobody spent. Errors that DID cost money (a Claude call that returns malformed
 * JSON) must surface as a resolved result, not a throw — see `src/enrich/`.
 */
export function createMeter(recorder: CostRecorder): Meter {
  return async function meter<T>(
    params: MeterParams<T>,
    fn: () => Promise<T>,
  ): Promise<T> {
    const result = await fn();
    const units = resolve(params.units, result);
    const unitCostUsd = resolve(params.unitCostUsd, result);
    const meta =
      params.meta === undefined ? undefined : resolve(params.meta, result);
    await recorder.record({
      provider: params.provider,
      operation: params.operation,
      pipelineStep: params.pipelineStep,
      practiceId: params.practiceId,
      units,
      unitCostUsd,
      costUsd: units * unitCostUsd,
      meta,
    });
    return result;
  };
}
