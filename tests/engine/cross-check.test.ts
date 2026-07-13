import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../setup";
import {
  attachSignal,
  firedSignalCount,
  resolvePractice,
} from "@/src/engine/resolver";
import { crossCheckSignals } from "@/src/engine/cross-check";
import { computeExpiresAt } from "@/src/engine/freshness";
import { createMeter, type CostEventRecord } from "@/src/roi/cost-meter";
import { practiceSignalRows } from "@/db/queries";
import { signalChecks, signals } from "@/db/schema";
import { eq } from "drizzle-orm";

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

    const meter = createMeter({
      record: async (row) => {
        costs.push(row);
      },
    });
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
    expect(
      rows.find((row) => row.kind === "staffing_spike")?.evidence.sourceUrl,
    ).toBe("https://jobs.example.com/texas-ortho-front-desk");
    expect(
      rows.find((row) => row.kind === "growth_events")?.evidence.sourceUrl,
    ).toBe("https://news.example.com/texas-orthopedics-expands");
    expect(costs.map((row) => `${row.provider}:${row.pipelineStep}`)).toEqual([
      "adzuna:cross-check",
      "gdelt:cross-check",
    ]);

    const checks = await t.db.select().from(signalChecks);
    expect(
      checks.map((row) => `${row.provider}:${row.kind}:${row.status}`).sort(),
    ).toEqual([
      "adzuna:staffing_spike:fired",
      "gdelt:growth_events:fired",
      "google-places:phone_complaints:skipped",
    ]);

    await crossCheckSignals(
      {
        db: t.db,
        meter,
        now: new Date("2026-07-12T12:00:00Z"),
        fetchJobs: async () => {
          throw new Error("should be skipped");
        },
        fetchArticles: async () => {
          throw new Error("should be skipped");
        },
      },
      practiceId,
    );

    expect(
      await t.db
        .select()
        .from(signals)
        .where(eq(signals.practiceId, practiceId)),
    ).toHaveLength(3);
    expect(costs.map((row) => `${row.provider}:${row.pipelineStep}`)).toEqual([
      "adzuna:cross-check",
      "gdelt:cross-check",
    ]);
  });

  it("records checked_no_signal without attaching a fake signal", async () => {
    const { practiceId } = await resolvePractice(t.db, {
      name: "Quiet Dermatology",
      geoKey: "austin-tx",
      city: "Austin",
      state: "TX",
      vertical: "dermatology",
    });
    await attachSignal(t.db, {
      practiceId,
      kind: "phone_complaints",
      sourceUrl: "https://maps.example.com/quiet",
      detectedAt: NOW,
    });

    const meter = createMeter({
      record: async (row) => {
        costs.push(row);
      },
    });
    await crossCheckSignals(
      {
        db: t.db,
        meter,
        now: NOW,
        fetchJobs: async () => ({ results: [] }),
        fetchArticles: async () => ({ articles: [] }),
      },
      practiceId,
    );

    expect(await firedSignalCount(t.db, practiceId)).toBe(1);
    const checks = await t.db.select().from(signalChecks);
    expect(checks.map((row) => `${row.kind}:${row.status}`).sort()).toEqual([
      "growth_events:checked_no_signal",
      "phone_complaints:skipped",
      "staffing_spike:checked_no_signal",
    ]);
  });

  it("re-checks stale existing signals and refreshes a re-confirmed citation", async () => {
    const { practiceId } = await resolvePractice(t.db, {
      name: "Renew Orthopedics",
      geoKey: "austin-tx",
      city: "Austin",
      state: "TX",
      vertical: "orthopedics",
    });
    await attachSignal(t.db, {
      practiceId,
      kind: "phone_complaints",
      sourceUrl: "https://maps.example.com/renew",
      detectedAt: NOW,
      expiresAt: computeExpiresAt("phone_complaints", NOW),
    });
    await attachSignal(t.db, {
      practiceId,
      kind: "staffing_spike",
      sourceUrl: "https://jobs.example.com/renew-front-desk",
      snippet: "Old front desk opening",
      detectedAt: new Date("2026-04-01T00:00:00Z"),
      expiresAt: new Date("2026-05-01T00:00:00Z"),
    });

    const meter = createMeter({
      record: async (row) => {
        costs.push(row);
      },
    });

    const summary = await crossCheckSignals(
      {
        db: t.db,
        meter,
        now: NOW,
        fetchJobs: async () => ({
          results: [
            {
              title: "Front Desk Coordinator",
              description: "Renew Orthopedics needs phones and scheduling help",
              company: { display_name: "Renew Orthopedics" },
              location: { display_name: "Austin, TX" },
              redirect_url: "https://jobs.example.com/renew-front-desk",
              created: NOW.toISOString(),
            },
          ],
        }),
        fetchArticles: async () => ({ articles: [] }),
      },
      practiceId,
    );

    expect(summary.checked).toContain("staffing_spike");
    expect(summary.attached).toContain("staffing_spike");
    const rows = await t.db
      .select()
      .from(signals)
      .where(eq(signals.practiceId, practiceId));
    expect(rows.filter((row) => row.kind === "staffing_spike")).toHaveLength(
      1,
    );
    const refreshed = rows.find((row) => row.kind === "staffing_spike");
    expect(refreshed?.detectedAt.toISOString()).toBe(NOW.toISOString());
    expect(refreshed?.expiresAt?.toISOString()).toBe(
      computeExpiresAt("staffing_spike", NOW).toISOString(),
    );
    expect(costs.map((row) => row.provider)).toContain("adzuna");
  });
});
