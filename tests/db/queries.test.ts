import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../setup";
import { upsertPractice, upsertSignal } from "@/db/ingest";
import { feedPractices, signalCount } from "@/db/queries";
import { evidence } from "@/db/schema";

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
      .values({ sourceUrl: url })
      .returning({ id: evidence.id });
    return row.id;
  }

  it("signalCount returns distinct fired-signal kinds", async () => {
    const p = await upsertPractice(t.db, {
      name: "Metro Ortho Group",
      geoKey: "denver-co",
    });
    await upsertSignal(t.db, {
      practiceId: p.id,
      kind: "staffing_spike",
      evidenceId: await makeEvidence("https://a.example.com"),
    });
    await upsertSignal(t.db, {
      practiceId: p.id,
      kind: "phone_complaints",
      evidenceId: await makeEvidence("https://b.example.com"),
    });
    // Same kind, different evidence — must NOT inflate the distinct-kind count.
    await upsertSignal(t.db, {
      practiceId: p.id,
      kind: "staffing_spike",
      evidenceId: await makeEvidence("https://c.example.com"),
    });

    expect(await signalCount(t.db, p.id)).toBe(2);
  });

  it("feedPractices ranks by derived signal count descending", async () => {
    const two = await upsertPractice(t.db, {
      name: "Two Signal Derm",
      geoKey: "miami-fl",
    });
    const one = await upsertPractice(t.db, {
      name: "One Signal Derm",
      geoKey: "orlando-fl",
    });
    await upsertSignal(t.db, {
      practiceId: two.id,
      kind: "staffing_spike",
      evidenceId: await makeEvidence("https://d.example.com"),
    });
    await upsertSignal(t.db, {
      practiceId: two.id,
      kind: "growth_events",
      evidenceId: await makeEvidence("https://e.example.com"),
    });
    await upsertSignal(t.db, {
      practiceId: one.id,
      kind: "staffing_spike",
      evidenceId: await makeEvidence("https://f.example.com"),
    });

    const feed = await feedPractices(t.db);
    expect(feed[0].id).toBe(two.id);
    expect(feed[0].signalCount).toBe(2);
    expect(feed[1].id).toBe(one.id);
    expect(feed[1].signalCount).toBe(1);
  });
});
