import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { createTestDb, type TestDb } from "../setup";
import { seedDemo } from "@/db/seed-demo";
import { buildScoreboardData, loadScoreboardInputs, loadScoreboardData } from "@/app/scoreboard/data";
import { feedPractices, practiceSignalRows } from "@/db/queries";
import { getBrief } from "@/db/brief";
import { renderBrief } from "@/src/brief/render";
import { roiEvents } from "@/db/schema";

/**
 * The UI-plumbing contract, proven end-to-end through the REAL data layer (U8/U9/U12).
 *
 * `seedDemo` writes the same rows the demo will run against; the assertions then drive the
 * exact functions the real routes call — `getBrief` + `practiceSignalRows` + `renderBrief`
 * for the brief page, `loadScoreboardData` for the scoreboard — and check the aggregate
 * numbers, the honesty tags, and idempotency. No network, no keys: PGlite is real Postgres.
 *
 * `NOW` is fixed so the seeded freshness windows and the render clock never drift apart.
 */
const NOW = new Date("2026-07-09T12:00:00Z");

describe("UI plumbing — seed → real routes", () => {
  let t: TestDb;
  beforeEach(async () => {
    t = await createTestDb();
    await seedDemo(t.db, NOW);
  });
  afterEach(async () => {
    await t.close();
  });

  // ── Feed (U8) ────────────────────────────────────────────────────────────
  it("the feed shows exactly the six fresh-signal practices, ranked", async () => {
    const feed = await feedPractices(t.db, NOW);
    expect(feed).toHaveLength(6);
    // Cedarline carries three fresh signals, so it ranks first (D8: signal count).
    expect(feed[0].name).toBe("Cedarline Dermatology Group");
    expect(feed[0].signalCount).toBe(3);
  });

  // ── Deep brief (U9) ──────────────────────────────────────────────────────
  it("the Cedarline brief renders found, with three live signals and its headline", async () => {
    const feed = await feedPractices(t.db, NOW);
    const cedarline = feed.find((r) => r.name === "Cedarline Dermatology Group");
    expect(cedarline).toBeDefined();

    const result = await getBrief(t.db, cedarline!.id);
    expect(result.status).toBe("found");
    if (result.status !== "found") return;

    const signals = await practiceSignalRows(t.db, cedarline!.id);
    expect(signals).toHaveLength(3);

    const rendered = renderBrief(result.brief, signals, NOW);
    expect(rendered.live.signalCount).toBe(3);
    // The moment it cites is still firing, so the model's headline stands (not the constant).
    expect(rendered.headline).toBe("Front desk underwater right as a 5th location opens");
    // The seeded signals match the stored fingerprint → the card is not stale.
    expect(rendered.stale).toBe(false);
  });

  it("a practice with no brief resolves to the honest 'missing' state, never a throw", async () => {
    const feed = await feedPractices(t.db, NOW);
    const harborlight = feed.find((r) => r.name === "Harborlight Women's Health");
    expect(harborlight).toBeDefined();
    const result = await getBrief(t.db, harborlight!.id);
    expect(result.status).toBe("missing");
  });

  // ── Scoreboard (U12) ─────────────────────────────────────────────────────
  it("aggregates the funnel into ScoreboardData with the honest measured/modeled tags", async () => {
    const data = await loadScoreboardData(t.db);

    // Every scope key the toggle can select is present (no fall-through to `all`).
    expect(Object.keys(data.scopes).sort()).toEqual(
      ["all", "dermatology", "ophthalmology", "orthopedics", "womens-health"].sort(),
    );

    const all = data.scopes.all;
    // Enterprise-scale demo funnel: 1,240 leads → 340 meetings → 92 deals.
    expect(all.endGoals[0].value).toBe("92"); // deals won
    expect(all.endGoals[0].honesty).toBe("modeled"); // a projected outcome
    expect(all.leading[0].value).toBe("340"); // meetings the tool booked
    expect(all.leading[0].honesty).toBe("measured"); // a real activity count
    expect(all.overallConversion).toBeCloseTo(340 / 1240, 5);

    // CAC + cost/meeting are computed, not fabricated — real spend over real counts.
    expect(all.endGoals[1].value).toBe("$41"); // ≈ $3,731 spend / 92 deals
    expect(all.leading[1].value).toBe("$11"); // ≈ $3,731 spend / 340 meetings

    // Hours saved (measured tool activity) and the 3-touch sequence.
    expect(all.leading[3].value).toBe("14819");
    expect(all.leading[2].value).toBe("3.0");

    // AE feedback: 👍 on every practice that booked, 👎 on a slice of the rest.
    expect(all.feedback.total).toBe(411);
    expect(all.feedback.thumbsUpRate).toBeCloseTo(0.827, 3);

    // The big test: buying-moment cohort out-converts the cold cohort ~4x.
    expect(data.bigTest.buyingMoment).toEqual({ meetings: 322, deals: 89 });
    expect(data.bigTest.cold).toEqual({ meetings: 18, deals: 3 });

    // Per-vertical rollup.
    expect(data.verticals).toHaveLength(4);
    const derm = data.verticals.find((v) => v.slug === "dermatology");
    expect(derm?.winRate).toBeCloseTo(38 / 321, 5); // 38 deals / 321 leads
    expect(derm?.cycleDays).toBe("31d");
  });

  it("degrades honestly: a scope with no deals shows '—' for CAC, not a divide-by-zero", async () => {
    const data = await loadScoreboardData(t.db);
    // Ophthalmology booked meetings but won no deals yet → CAC has no denominator.
    const ophth = data.scopes.ophthalmology;
    expect(ophth.endGoals[0].value).toBe("0"); // deals
    expect(ophth.endGoals[1].value).toBe("—"); // CAC: 0 deals → no number, not $Infinity
  });

  it("an empty database yields an all-zero scoreboard, never a crash", async () => {
    const fresh = await createTestDb();
    try {
      const data = await loadScoreboardData(fresh.db);
      expect(data.scopes.all.leading[0].value).toBe("0");
      expect(data.scopes.all.endGoals[1].value).toBe("—");
      expect(data.bigTest.buyingMoment).toEqual({ meetings: 0, deals: 0 });
    } finally {
      await fresh.close();
    }
  });

  // ── Idempotency (D13 / R17) ──────────────────────────────────────────────
  it("re-running the seed writes nothing new", async () => {
    const before = await t.db.select({ n: sql<number>`count(*)` }).from(roiEvents);
    await seedDemo(t.db, NOW); // second run
    const after = await t.db.select({ n: sql<number>`count(*)` }).from(roiEvents);
    expect(Number(after[0].n)).toBe(Number(before[0].n));

    // And the aggregate numbers are unchanged.
    const data = buildScoreboardData(await loadScoreboardInputs(t.db));
    expect(data.scopes.all.leading[0].value).toBe("340");
  });
});
