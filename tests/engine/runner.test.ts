import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../setup";
import { runDetectors } from "@/jobs/run-detectors";
import type {
  Detector,
  DetectorKind,
  SignalCandidate,
} from "@/src/engine/detector";
import { createMeter, type CostEventRecord } from "@/src/roi/cost-meter";
import { evidence, practices, signals } from "@/db/schema";

const NOW = new Date("2026-07-02T00:00:00Z");
const DETECTED = new Date("2026-07-01T00:00:00Z");

function staticDetector(
  kind: DetectorKind,
  name: string,
  candidates: SignalCandidate[],
): Detector {
  return { kind, name, detect: async () => candidates };
}

const staffingCandidate: SignalCandidate = {
  practiceHint: "Sunshine Dermatology",
  kind: "staffing_spike",
  confidence: 0.82,
  detectedAt: DETECTED,
  geoKey: "tampa-fl",
  evidence: [
    {
      claim: "Hiring 3 front-desk coordinators",
      sourceUrl: "https://boards.example.com/job/1",
      snippet: "3 openings posted",
      confidence: 0.9,
    },
  ],
};

describe("runDetectors", () => {
  let t: TestDb;
  beforeEach(async () => {
    t = await createTestDb();
  });
  afterEach(async () => {
    await t.close();
  });

  it("persists a detector's emission with source URL, confidence, and freshness", async () => {
    const summary = await runDetectors({
      db: t.db,
      detectors: [staticDetector("staffing_spike", "fake-jobs", [staffingCandidate])],
      now: NOW,
    });

    expect(summary.ran).toBe(true);
    expect(summary.reports[0].ingested).toBe(1);
    expect(summary.totals.ingested).toBe(1);

    const [ev] = await t.db.select().from(evidence);
    expect(ev.sourceUrl).toBe("https://boards.example.com/job/1");
    expect(ev.snippet).toBe("3 openings posted");
    expect(Number(ev.confidence)).toBeCloseTo(0.9, 10);

    const [sig] = await t.db.select().from(signals);
    expect(sig.kind).toBe("staffing_spike");
    // expires_at = detectedAt (2026-07-01) + 30d window.
    expect(sig.expiresAt).toEqual(new Date("2026-07-31T00:00:00Z"));
  });

  it("de-dupes identical evidence across runs (no duplicate rows)", async () => {
    const detectors = [
      staticDetector("staffing_spike", "fake-jobs", [staffingCandidate]),
    ];
    const first = await runDetectors({ db: t.db, detectors, now: NOW });
    const second = await runDetectors({ db: t.db, detectors, now: NOW });

    expect(first.totals.ingested).toBe(1);
    expect(second.totals.ingested).toBe(0);
    expect(second.totals.duplicate).toBe(1);

    expect(await t.db.select().from(signals)).toHaveLength(1);
    expect(await t.db.select().from(evidence)).toHaveLength(1);
    expect(await t.db.select().from(practices)).toHaveLength(1);
  });

  it("isolates a throwing detector — it is logged and the others still run", async () => {
    const boom: Detector = {
      kind: "growth_events",
      name: "flaky-news",
      detect: async () => {
        throw new Error("upstream 503");
      },
    };
    const good = staticDetector("staffing_spike", "fake-jobs", [staffingCandidate]);
    const logs: Array<{ event: string; meta?: Record<string, unknown> }> = [];

    const summary = await runDetectors({
      db: t.db,
      detectors: [boom, good], // throwing one runs FIRST
      now: NOW,
      logger: (event, meta) => logs.push({ event, meta }),
    });

    const [boomReport, goodReport] = summary.reports;
    expect(boomReport.detector).toBe("flaky-news");
    expect(boomReport.status).toBe("errored");
    expect(boomReport.error).toContain("upstream 503");

    expect(goodReport.detector).toBe("fake-jobs");
    expect(goodReport.status).toBe("ok");
    expect(goodReport.ingested).toBe(1);

    expect(summary.totals.errored).toBe(1);
    expect(summary.totals.ingested).toBe(1);
    // The healthy detector's signal persisted despite the earlier throw.
    expect(await t.db.select().from(signals)).toHaveLength(1);
    expect(logs.some((l) => l.event === "detector.error")).toBe(true);
  });

  it("hands a cost meter to detectors for their own paid fetches (R19)", async () => {
    const recorded: CostEventRecord[] = [];
    const meter = createMeter({
      record: async (row) => {
        recorded.push(row);
      },
    });

    const metered: Detector = {
      kind: "growth_events",
      name: "metered-source",
      detect: async (ctx) => {
        const fetched = ctx.meter
          ? await ctx.meter(
              {
                provider: "pdl",
                operation: "search",
                pipelineStep: "detect",
                units: 1,
                unitCostUsd: 0.02,
              },
              async () => "raw-payload",
            )
          : "raw-payload";
        const candidate: SignalCandidate = {
          practiceHint: "Metro Ortho Group",
          kind: "growth_events",
          confidence: 0.5,
          detectedAt: DETECTED,
          evidence: [
            {
              claim: `opened a new clinic (${fetched})`,
              sourceUrl: "https://news.example.com/story/1",
            },
          ],
        };
        return [candidate];
      },
    };

    const summary = await runDetectors({
      db: t.db,
      detectors: [metered],
      now: NOW,
      meter,
    });

    expect(summary.totals.ingested).toBe(1);
    expect(recorded).toHaveLength(1);
    expect(recorded[0].provider).toBe("pdl");
    expect(recorded[0].costUsd).toBeCloseTo(0.02, 10);
  });
});
