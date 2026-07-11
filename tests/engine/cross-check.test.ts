import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../setup";
import { attachSignal, firedSignalCount, resolvePractice } from "@/src/engine/resolver";
import { crossCheckSignals } from "@/src/engine/cross-check";
import { createMeter, type CostEventRecord } from "@/src/roi/cost-meter";
import { practiceSignalRows } from "@/db/queries";

const NOW = new Date("2026-07-11T12:00:00Z");

describe("crossCheckSignals", () => {
  let t: TestDb;
  let costs: CostEventRecord[];

  beforeEach(async () => {
    t = await createTestDb();
    costs = [];
  });

  afterEach(async () => {
    await t.close();
  });

  it("attaches cited staffing and growth signals to an already-qualified practice", async () => {
    const { practiceId } = await resolvePractice(t.db, {
      name: "Texas Orthopedics",
      geoKey: "austin-tx",
      city: "Austin",
      state: "TX",
      vertical: "orthopedics",
    });
    await attachSignal(t.db, {
      practiceId,
      kind: "phone_complaints",
      sourceUrl: "https://maps.example.com/texas-orthopedics",
      detectedAt: NOW,
    });

    const meter = createMeter({ record: async (row) => { costs.push(row); } });
    const summary = await crossCheckSignals(
      {
        db: t.db,
        meter,
        now: NOW,
        fetchJobs: async (query) => {
          expect(query.where).toBe("Austin, TX");
          return {
            results: [
              {
                title: "Front Desk Patient Coordinator",
                description: "Answer phones and schedule patients",
                company: { display_name: "Texas Orthopedics - South Austin" },
                location: { display_name: "Austin, Travis County" },
                redirect_url: "https://jobs.example.com/texas-ortho-front-desk",
                created: "2026-07-10T00:00:00Z",
              },
            ],
          };
        },
        fetchArticles: async () => ({
          articles: [
            {
              url: "https://news.example.com/texas-orthopedics-expands",
              title: "Texas Orthopedics Opens New Location in Austin",
              seendate: "20260709T130000Z",
              sourcecountry: "United States",
            },
          ],
        }),
      },
      practiceId,
    );

    expect(summary.attached).toEqual(["staffing_spike", "growth_events"]);
    expect(await firedSignalCount(t.db, practiceId)).toBe(3);
    const rows = await practiceSignalRows(t.db, practiceId);
    expect(rows.map((row) => row.kind).sort()).toEqual([
      "growth_events",
      "phone_complaints",
      "staffing_spike",
    ]);
    expect(rows.find((row) => row.kind === "staffing_spike")?.evidence.sourceUrl).toBe(
      "https://jobs.example.com/texas-ortho-front-desk",
    );
    expect(rows.find((row) => row.kind === "growth_events")?.evidence.sourceUrl).toBe(
      "https://news.example.com/texas-orthopedics-expands",
    );
    expect(costs.map((row) => `${row.provider}:${row.pipelineStep}`)).toEqual([
      "adzuna:cross-check",
      "gdelt:cross-check",
    ]);
  });
});
