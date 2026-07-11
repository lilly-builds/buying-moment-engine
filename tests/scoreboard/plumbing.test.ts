import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { createTestDb, type TestDb } from "../setup";
import { seedDemo } from "@/db/seed-demo";
import { buildScoreboardData, loadScoreboardInputs, loadScoreboardData } from "@/app/scoreboard/data";
import { DEMO_GEO_KEY_PREFIX, feedPractices, practiceSignalRows } from "@/db/queries";
import { getBrief } from "@/db/brief";
import { renderBrief } from "@/src/brief/render";
import { practices, roiEvents } from "@/db/schema";

/**
 * The UI-plumbing contract, proven end-to-end through the REAL data layer (U8/U9/U12).
 *
 * `seedDemo` writes clearly-demo rows (every practice carries a `demo:` geo key). The
 * integrity fix (D9 / ROI honesty) is that those rows NEVER reach the live `/feed` or
 * `/scoreboard` — only the real pipeline does. So this file proves two things:
 *
 *   1. Exclusion — after `seedDemo`, the real feed is empty and the real scoreboard is
 *      the honest all-zero board (no fabricated ROI leaks through).
 *   2. Aggregation math — the assembler still turns a realistic funnel into the right
 *      `ScoreboardData`. Because the real board excludes `demo:` keys, we RELABEL the
 *      seeded cohort as real (strip the prefix) to run the pipeline over data the board
 *      actually counts. Same rows, now counted; the numbers prove the math while block 1
 *      proves the exclusion.
 *
 * `NOW` is fixed so the seeded freshness windows and the render clock never drift apart.
 * No network, no keys: PGlite is real Postgres.
 */
const NOW = new Date("2026-07-09T12:00:00Z");

/** Relabel every seeded practice as real by stripping the `demo:` prefix from its geo key. */
async function promoteSeedToReal(t: TestDb): Promise<void> {
  await t.db
    .update(practices)
    .set({ geoKey: sql`replace(${practices.geoKey}, ${DEMO_GEO_KEY_PREFIX}, '')` });
}

describe("real feed + scoreboard EXCLUDE demo-seeded data (D9 integrity fix)", () => {
  let t: TestDb;
  beforeEach(async () => {
    t = await createTestDb();
    await seedDemo(t.db, NOW);
  });
  afterEach(async () => {
    await t.close();
  });

  it("the real feed carries none of the demo-seeded practices", async () => {
    expect(await feedPractices(t.db, NOW)).toEqual([]);
  });

  it("the real scoreboard is the honest all-zero board, not fabricated seed ROI", async () => {
    const data = await loadScoreboardData(t.db);
    expect(data.scopes.all.leading[0].value).toBe("0"); // meetings the tool booked
    expect(data.scopes.all.endGoals[0].value).toBe("0"); // deals won
    expect(data.scopes.all.endGoals[1].value).toBe("—"); // CAC: no denominator → no number
    expect(data.scopes.all.feedback.total).toBe(0);
    expect(data.bigTest.buyingMoment).toEqual({ meetings: 0, deals: 0 });
  });

  // The deep brief is a per-id lookup, NOT a real-board aggregate, so reaching a seeded
  // practice directly (e.g. a deep link) still renders. Proven here so the exclusion is
  // scoped to the feed/scoreboard, not to every read.
  it("the deep brief still renders for a practice reached by id", async () => {
    const [cedarline] = await t.db
      .select({ id: practices.id })
      .from(practices)
      .where(eq(practices.geoKey, "demo:cedarline-austin-tx"));
    expect(cedarline).toBeDefined();

    const result = await getBrief(t.db, cedarline.id);
    expect(result.status).toBe("found");
    if (result.status !== "found") return;

    const signals = await practiceSignalRows(t.db, cedarline.id);
    expect(signals).toHaveLength(3);

    const rendered = renderBrief(result.brief, signals, NOW);
    expect(rendered.live.signalCount).toBe(3);
    expect(rendered.headline).toBe("Front desk underwater right as a 5th location opens");
    expect(rendered.stale).toBe(false);
  });

  it("a seeded practice with no brief resolves to the honest 'missing' state", async () => {
    const [harborlight] = await t.db
      .select({ id: practices.id })
      .from(practices)
      .where(eq(practices.geoKey, "demo:harborlight"));
    const result = await getBrief(t.db, harborlight.id);
    expect(result.status).toBe("missing");
  });
});

describe("scoreboard aggregation math over a REAL cohort", () => {
  let t: TestDb;
  beforeEach(async () => {
    t = await createTestDb();
    await seedDemo(t.db, NOW);
    await promoteSeedToReal(t); // relabel as real so the real board counts the funnel
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

  // ── Scoreboard (U12) ─────────────────────────────────────────────────────
  it("aggregates the funnel into ScoreboardData with the honest measured/modeled tags", async () => {
    const data = await loadScoreboardData(t.db);

    // Every scope key the toggle can select is present (no fall-through to `all`).
    expect(Object.keys(data.scopes).sort()).toEqual(
      ["all", "dermatology", "ophthalmology", "orthopedics", "womens-health"].sort(),
    );

    const all = data.scopes.all;
    // 18 leads → 10 meetings → 4 deals.
    expect(all.endGoals[0].value).toBe("4"); // deals won
    expect(all.endGoals[0].honesty).toBe("modeled"); // a projected outcome
    expect(all.leading[0].value).toBe("10"); // meetings the tool booked
    expect(all.leading[0].honesty).toBe("measured"); // a real activity count
    expect(all.overallConversion).toBeCloseTo(10 / 18, 5);

    // CAC + cost/meeting are computed, not fabricated — real spend over real counts.
    expect(all.endGoals[1].value).toBe("$20"); // $81.10 spend / 4 deals
    expect(all.leading[1].value).toBe("$8"); // $81.10 spend / 10 meetings

    // Hours saved (measured tool activity) and the 3-touch sequence.
    expect(all.leading[3].value).toBe("134");
    expect(all.leading[2].value).toBe("3.0");

    // AE feedback: 6 up / 4 down across the seed.
    expect(all.feedback.total).toBe(10);
    expect(all.feedback.thumbsUpRate).toBeCloseTo(0.6, 5);

    // The big test: buying-moment cohort out-converts the cold cohort.
    expect(data.bigTest.buyingMoment).toEqual({ meetings: 9, deals: 4 });
    expect(data.bigTest.cold).toEqual({ meetings: 1, deals: 0 });

    // Per-vertical rollup.
    expect(data.verticals).toHaveLength(4);
    const derm = data.verticals.find((v) => v.slug === "dermatology");
    expect(derm?.winRate).toBeCloseTo(0.5, 5); // 2 deals / 4 leads
    expect(derm?.cycleDays).toBe("31d");
  });

  it("degrades honestly: a scope with no meetings shows '—', not a divide-by-zero", async () => {
    const data = await loadScoreboardData(t.db);
    // Ophthalmology booked one meeting but won no deals → CAC has no denominator.
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
});

// ── Idempotency (D13 / R17) ────────────────────────────────────────────────
describe("seed idempotency", () => {
  let t: TestDb;
  beforeEach(async () => {
    t = await createTestDb();
    await seedDemo(t.db, NOW);
  });
  afterEach(async () => {
    await t.close();
  });

  it("re-running the seed writes nothing new, and the board stays honestly zero", async () => {
    const before = await t.db.select({ n: sql<number>`count(*)` }).from(roiEvents);
    await seedDemo(t.db, NOW); // second run
    const after = await t.db.select({ n: sql<number>`count(*)` }).from(roiEvents);
    expect(Number(after[0].n)).toBe(Number(before[0].n));

    // And the real board is still zero — demo rows never leak in, run once or twice.
    const data = buildScoreboardData(await loadScoreboardInputs(t.db));
    expect(data.scopes.all.leading[0].value).toBe("0");
  });
});
