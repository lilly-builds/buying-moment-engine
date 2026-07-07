import { describe, expect, it } from "vitest";
import {
  createMeter,
  type CostEventRecord,
  type CostRecorder,
} from "@/src/roi/cost-meter";

describe("cost meter (R19)", () => {
  it("writes one cost_events row with cost_usd = units x unit_cost_usd", async () => {
    const rows: CostEventRecord[] = [];
    const fake: CostRecorder = {
      record: async (row) => {
        rows.push(row);
      },
    };
    const meter = createMeter(fake);

    const result = await meter(
      {
        provider: "anthropic",
        operation: "brief.synthesize",
        pipelineStep: "synthesize",
        practiceId: "practice-1",
        units: 1200,
        unitCostUsd: 0.00001,
      },
      async () => "BRIEF_JSON",
    );

    expect(result).toBe("BRIEF_JSON");
    expect(rows).toHaveLength(1);
    expect(rows[0].costUsd).toBeCloseTo(0.012, 10);
    expect(rows[0].provider).toBe("anthropic");
    expect(rows[0].pipelineStep).toBe("synthesize");
    expect(rows[0].practiceId).toBe("practice-1");
  });

  it("returns the wrapped call's result unchanged", async () => {
    const meter = createMeter({ record: async () => {} });
    const value = await meter(
      {
        provider: "clay",
        operation: "enrich",
        pipelineStep: "enrich",
        units: 1,
        unitCostUsd: 0.1,
      },
      async () => ({ enriched: true }),
    );
    expect(value).toEqual({ enriched: true });
  });
});
