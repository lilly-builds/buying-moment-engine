import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../setup";
import { upsertPractice, upsertSignal } from "@/db/ingest";
import { feedPractices, signalCount } from "@/db/queries";
import { evidence } from "@/db/schema";

const DETECTED = new Date("2026-07-01T00:00:00Z");

describe("derived signal-count queries", () => {
  let t: TestDb;
  beforeEach(async () => {
    t = await createTestDb();
  });
  afterEach(async () => {
    await t.close();
  });

  async function makeEvidence(url: string): Promise<string> {
    const [row] = await t.db
      .insert(evidence)
      .values({ sourceUrl: url, detectedAt: DETECTED })
      .returning({ id: evidence.id });
    return row.id;
  }

  it("signalCount returns distinct fired-signal kinds", async () => {
    const p = await upsertPractice(t.db, {
      name: "Metro Ortho Group",
      geoKey: "denver-co",
      vertical: "orthopedics",
    });
    await upsertSignal(t.db, {
      practiceId: p.id,
      kind: "staffing_spike",
      evidenceId: await makeEvidence("https://a.example.com"),
      detectedAt: DETECTED,
    });
    await upsertSignal(t.db, {
      practiceId: p.id,
      kind: "phone_complaints",
      evidenceId: await makeEvidence("https://b.example.com"),
      detectedAt: DETECTED,
    });
    // Same kind, different evidence — must NOT inflate the distinct-kind count.
    await upsertSignal(t.db, {
      practiceId: p.id,
      kind: "staffing_spike",
      evidenceId: await makeEvidence("https://c.example.com"),
      detectedAt: DETECTED,
    });

    expect(await signalCount(t.db, p.id)).toBe(2);
  });

  it("feedPractices ranks by derived signal count descending", async () => {
    const two = await upsertPractice(t.db, {
      name: "Two Signal Derm",
      geoKey: "miami-fl",
      vertical: "dermatology",
    });
    const one = await upsertPractice(t.db, {
      name: "One Signal Derm",
      geoKey: "orlando-fl",
      vertical: "dermatology",
    });
    await upsertSignal(t.db, {
      practiceId: two.id,
      kind: "staffing_spike",
      evidenceId: await makeEvidence("https://d.example.com"),
      detectedAt: DETECTED,
    });
    await upsertSignal(t.db, {
      practiceId: two.id,
      kind: "growth_events",
      evidenceId: await makeEvidence("https://e.example.com"),
      detectedAt: DETECTED,
    });
    await upsertSignal(t.db, {
      practiceId: one.id,
      kind: "staffing_spike",
      evidenceId: await makeEvidence("https://f.example.com"),
      detectedAt: DETECTED,
    });

    const feed = await feedPractices(t.db);
    expect(feed[0].id).toBe(two.id);
    expect(feed[0].signalCount).toBe(2);
    expect(feed[1].id).toBe(one.id);
    expect(feed[1].signalCount).toBe(1);
  });

  it("a classified, enriched practice with ZERO fired signals stays OUT of the feed (R1)", async () => {
    // Exactly the row U8's pull mode creates: someone pastes a practice name, the
    // waterfall enriches it and tags a vertical, but no signal fires. It is a real
    // practice with a real brief — and it is NOT at a buying moment, so the push
    // feed must not carry it. (Its zero-signal brief page is a separate surface.)
    const noSignals = await upsertPractice(t.db, {
      name: "Quiet Derm",
      geoKey: "boise-id",
      vertical: "dermatology",
    });
    const fired = await upsertPractice(t.db, {
      name: "Busy Derm",
      geoKey: "austin-tx",
      vertical: "dermatology",
    });
    await upsertSignal(t.db, {
      practiceId: fired.id,
      kind: "staffing_spike",
      evidenceId: await makeEvidence("https://jobs.example.com/busy"),
      detectedAt: DETECTED,
    });

    const feed = await feedPractices(t.db);
    expect(feed.map((r) => r.id)).toEqual([fired.id]);
    expect(feed.map((r) => r.name)).not.toContain("Quiet Derm");
  });
});
