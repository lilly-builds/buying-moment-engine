import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../setup";
import { upsertPractice, upsertSignal } from "@/db/ingest";
import { feedPractices, practicesNeedingBriefs, signalCount } from "@/db/queries";
import { briefs, evidence } from "@/db/schema";

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
    // A real, classified, enriched practice — but no signal ever fires on it.
    await upsertPractice(t.db, {
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

describe("practicesNeedingBriefs (U4 — the seeding pull)", () => {
  let t: TestDb;
  const NOW = new Date("2026-07-09T00:00:00Z");
  const FRESH = new Date("2026-07-08T00:00:00Z");
  const FRESH_EXP = new Date("2026-07-20T00:00:00Z"); // future → fresh
  const EXPIRED_EXP = new Date("2026-07-02T00:00:00Z"); // past → stale

  beforeEach(async () => {
    t = await createTestDb();
  });
  afterEach(async () => {
    await t.close();
  });

  async function evidenceAt(url: string, when: Date): Promise<string> {
    const [row] = await t.db
      .insert(evidence)
      .values({ sourceUrl: url, detectedAt: when })
      .returning({ id: evidence.id });
    return row.id;
  }
  async function fresh(practiceId: string, kind: "staffing_spike" | "phone_complaints" | "growth_events", detectedAt: Date, url: string) {
    await upsertSignal(t.db, {
      practiceId,
      kind,
      evidenceId: await evidenceAt(url, detectedAt),
      detectedAt,
      expiresAt: FRESH_EXP,
    });
  }

  it("returns un-briefed classified practices with fresh signals, hottest first; excludes briefed/unclassified/expired", async () => {
    // A: classified, 2 fresh signals, no brief → returned first (count 2).
    const a = await upsertPractice(t.db, { name: "Alpha Derm", geoKey: "austin-tx", vertical: "dermatology", websiteUrl: "https://alphaderm.com" });
    await fresh(a.id, "staffing_spike", FRESH, "https://a1");
    await fresh(a.id, "phone_complaints", FRESH, "https://a2");

    // G: classified, 1 fresh signal (newest), no brief → second.
    const g = await upsertPractice(t.db, { name: "Gamma Derm", geoKey: "dallas-tx", vertical: "dermatology" });
    await fresh(g.id, "staffing_spike", new Date("2026-07-08T12:00:00Z"), "https://g1");

    // E: classified, 1 fresh signal (older), no brief → third.
    const e = await upsertPractice(t.db, { name: "Echo Derm", geoKey: "miami-fl", vertical: "dermatology" });
    await fresh(e.id, "staffing_spike", new Date("2026-07-05T00:00:00Z"), "https://e1");

    // B: classified, 1 fresh signal, HAS a brief → excluded.
    const b = await upsertPractice(t.db, { name: "Beta Derm", geoKey: "reno-nv", vertical: "dermatology" });
    await fresh(b.id, "staffing_spike", FRESH, "https://b1");
    await t.db.insert(briefs).values({ practiceId: b.id });

    // C: UNCLASSIFIED, 1 fresh signal, no brief → excluded.
    const c = await upsertPractice(t.db, { name: "Gray Clinic", geoKey: "boise-id" });
    await fresh(c.id, "staffing_spike", FRESH, "https://c1");

    // D: classified, only an EXPIRED signal, no brief → excluded.
    const d = await upsertPractice(t.db, { name: "Delta Derm", geoKey: "tampa-fl", vertical: "dermatology" });
    await upsertSignal(t.db, {
      practiceId: d.id,
      kind: "staffing_spike",
      evidenceId: await evidenceAt("https://d1", new Date("2026-07-01T00:00:00Z")),
      detectedAt: new Date("2026-07-01T00:00:00Z"),
      expiresAt: EXPIRED_EXP,
    });

    const result = await practicesNeedingBriefs(t.db, { now: NOW });
    expect(result.map((r) => r.id)).toEqual([a.id, g.id, e.id]);
    expect(result[0].freshSignalCount).toBe(2);
    expect(result[1].freshSignalCount).toBe(1);
    // returned fields carry the scrape seed + geo the conductor needs
    expect(result[0].websiteUrl).toBe("https://alphaderm.com");
    expect(result[0].geoKey).toBe("austin-tx");
    expect(result[1].websiteUrl).toBeNull();
  });

  it("includeBriefed (--force) pulls already-briefed practices too", async () => {
    const a = await upsertPractice(t.db, { name: "Alpha Derm", geoKey: "austin-tx", vertical: "dermatology" });
    await fresh(a.id, "staffing_spike", FRESH, "https://a1");
    await t.db.insert(briefs).values({ practiceId: a.id });

    // default: excluded (has a brief)
    expect(await practicesNeedingBriefs(t.db, { now: NOW })).toHaveLength(0);
    // includeBriefed: pulled for deliberate regeneration
    const forced = await practicesNeedingBriefs(t.db, { now: NOW, includeBriefed: true });
    expect(forced.map((r) => r.id)).toEqual([a.id]);
  });

  it("limit caps the result to the hottest N", async () => {
    const a = await upsertPractice(t.db, { name: "Alpha Derm", geoKey: "austin-tx", vertical: "dermatology" });
    await fresh(a.id, "staffing_spike", FRESH, "https://a1");
    await fresh(a.id, "phone_complaints", FRESH, "https://a2");
    const e = await upsertPractice(t.db, { name: "Echo Derm", geoKey: "miami-fl", vertical: "dermatology" });
    await fresh(e.id, "staffing_spike", FRESH, "https://e1");

    const result = await practicesNeedingBriefs(t.db, { now: NOW, limit: 1 });
    expect(result.map((r) => r.id)).toEqual([a.id]);
  });
});
