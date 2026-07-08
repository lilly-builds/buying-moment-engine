import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../setup";
import { upsertPractice, upsertSignal } from "@/db/ingest";
import { feedPractices } from "@/db/queries";
import { computeExpiresAt } from "@/src/engine/freshness";
import { evidence } from "@/db/schema";

/**
 * The feed's freshness contract (U8).
 *
 * Every practice here is invented for this file. Nothing is copied from a real
 * record — the production database holds real named clinics, and a fixture is not
 * allowed to become one.
 *
 * `NOW` is fixed. A wall-clock test whose signals expire on a real calendar date
 * passes today and fails silently in five weeks.
 */
const NOW = new Date("2026-07-08T12:00:00Z");
const daysBefore = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);

describe("feedPractices — freshness", () => {
  let t: TestDb;
  beforeEach(async () => {
    t = await createTestDb();
  });
  afterEach(async () => {
    await t.close();
  });

  let evidenceSeq = 0;
  async function makeEvidence(): Promise<string> {
    const [row] = await t.db
      .insert(evidence)
      .values({
        sourceUrl: `https://example.test/e/${++evidenceSeq}`,
        detectedAt: NOW,
      })
      .returning({ id: evidence.id });
    return row.id;
  }

  /** A signal whose expiry is computed the same way ingest computes it. */
  async function fire(
    practiceId: string,
    kind: Parameters<typeof computeExpiresAt>[0],
    detectedDaysAgo: number,
  ) {
    const detectedAt = daysBefore(detectedDaysAgo);
    await upsertSignal(t.db, {
      practiceId,
      kind,
      evidenceId: await makeEvidence(),
      detectedAt,
      expiresAt: computeExpiresAt(kind, detectedAt),
    });
  }

  async function derm(name: string, geoKey: string) {
    return upsertPractice(t.db, { name, geoKey, vertical: "dermatology" });
  }

  it("a 10-day-old staffing signal is STILL FRESH — the window is 30 days, not 7", async () => {
    // The trap this file exists for. `FreshnessClock` defaults to a 7-day stale window,
    // but `FRESHNESS_WINDOW_DAYS.staffing_spike` is 30. A row driven by the component's
    // default would show a healthy lead in red and the AE would skip it.
    const p = await derm("Fixture Derm A", "geo-a");
    await fire(p.id, "staffing_spike", 10);

    const feed = await feedPractices(t.db, NOW);
    expect(feed).toHaveLength(1);
    expect(feed[0].signalCount).toBe(1);
    expect(feed[0].freshest.kind).toBe("staffing_spike");
  });

  it("drops a practice whose only signal has aged past its window", async () => {
    // 31 days > the 30-day staffing window. It is not a buying moment any more, so the
    // practice is not in the feed at all — not merely ranked last.
    const p = await derm("Fixture Derm B", "geo-b");
    await fire(p.id, "staffing_spike", 31);

    expect(await feedPractices(t.db, NOW)).toEqual([]);
  });

  it("counts only FRESH kinds, so the feed can never out-claim the brief", async () => {
    // Before this guard the row said "2 signals" and the brief — which filters through
    // `freshSignals` — said "1". Same practice, one click apart, two different truths.
    const p = await derm("Fixture Derm C", "geo-c");
    await fire(p.id, "staffing_spike", 31); // expired (window 30)
    await fire(p.id, "phone_complaints", 31); // fresh   (window 90)

    const feed = await feedPractices(t.db, NOW);
    expect(feed).toHaveLength(1);
    expect(feed[0].signalCount).toBe(1);
    expect(feed[0].signals.map((s) => s.kind)).toEqual(["phone_complaints"]);
  });

  it("a null expiry is treated as fresh — an undated window is not a dead one", async () => {
    const p = await derm("Fixture Derm D", "geo-d");
    await upsertSignal(t.db, {
      practiceId: p.id,
      kind: "growth_events",
      evidenceId: await makeEvidence(),
      detectedAt: daysBefore(400),
      expiresAt: null,
    });

    const feed = await feedPractices(t.db, NOW);
    expect(feed).toHaveLength(1);
  });

  it("ranks by distinct fresh kinds, then by freshness at equal counts", async () => {
    const three = await derm("Fixture Derm Three", "geo-3");
    await fire(three.id, "staffing_spike", 2);
    await fire(three.id, "phone_complaints", 2);
    await fire(three.id, "growth_events", 2);

    const oneStale = await derm("Fixture Derm One Older", "geo-1a");
    await fire(oneStale.id, "staffing_spike", 20);

    const oneFresh = await derm("Fixture Derm One Newer", "geo-1b");
    await fire(oneFresh.id, "staffing_spike", 1);

    const feed = await feedPractices(t.db, NOW);
    expect(feed.map((r) => r.id)).toEqual([three.id, oneFresh.id, oneStale.id]);
    expect(feed[0].signalCount).toBe(3);
  });

  it("collapses repeat postings of one kind into a single signal", async () => {
    // Three job ads are not three buying moments. Ranking on evidence rows instead of
    // distinct kinds would put this practice above one with three DIFFERENT signals.
    const spammy = await derm("Fixture Derm Spammy", "geo-s");
    await fire(spammy.id, "staffing_spike", 5);
    await fire(spammy.id, "staffing_spike", 3);
    await fire(spammy.id, "staffing_spike", 1);

    const feed = await feedPractices(t.db, NOW);
    expect(feed[0].signalCount).toBe(1);
    expect(feed[0].signals).toHaveLength(1);
    // ...and the surviving entry carries the FRESHEST detection, not the first seen.
    expect(feed[0].signals[0].detectedAt).toEqual(daysBefore(1));
  });

  it("pills come back freshest-first", async () => {
    const p = await derm("Fixture Derm Order", "geo-o");
    await fire(p.id, "phone_complaints", 9);
    await fire(p.id, "growth_events", 1);
    await fire(p.id, "staffing_spike", 5);

    const feed = await feedPractices(t.db, NOW);
    expect(feed[0].signals.map((s) => s.kind)).toEqual([
      "growth_events",
      "staffing_spike",
      "phone_complaints",
    ]);
    expect(feed[0].freshest.kind).toBe("growth_events");
  });

  it("still excludes unclassified practices, however many signals fired", async () => {
    const p = await upsertPractice(t.db, {
      name: "Fixture Unclassified",
      geoKey: "geo-u",
      vertical: "unclassified",
    });
    await fire(p.id, "staffing_spike", 1);
    await fire(p.id, "growth_events", 1);

    expect(await feedPractices(t.db, NOW)).toEqual([]);
  });
});
