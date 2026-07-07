import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../setup";
import { ingestRawSignal } from "@/db/ingest";
import { evidence, practices, rawSignals, signals } from "@/db/schema";

const validSignal = {
  dedupeHash: "hash-1",
  detectorKind: "staffing_spike",
  payload: { snippet: "Hiring patient coordinator", confidence: 0.9 },
  sourceUrl: "https://boards.example.com/job/1",
  practiceHint: "Sunshine Dermatology",
  detectedAt: "2026-07-01T00:00:00Z",
  geoKey: "tampa-fl",
};

describe("ingestRawSignal", () => {
  let t: TestDb;
  beforeEach(async () => {
    t = await createTestDb();
  });
  afterEach(async () => {
    await t.close();
  });

  it("re-ingesting the same raw signal (same dedupe_hash) is a no-op", async () => {
    const first = await ingestRawSignal(t.db, validSignal);
    expect(first.status).toBe("ingested");

    const second = await ingestRawSignal(t.db, validSignal);
    expect(second.status).toBe("duplicate");

    expect(await t.db.select().from(rawSignals)).toHaveLength(1);
    expect(await t.db.select().from(signals)).toHaveLength(1);
    expect(await t.db.select().from(practices)).toHaveLength(1);
  });

  it("flags a malformed raw row rejected and never promotes it to normalized tables", async () => {
    const malformed = {
      dedupeHash: "bad-1",
      detectorKind: "staffing_spike",
      payload: {},
      sourceUrl: "not-a-url",
      practiceHint: "",
    };
    const res = await ingestRawSignal(t.db, malformed);
    expect(res.status).toBe("rejected");

    const [raw] = await t.db.select().from(rawSignals);
    expect(raw.validationStatus).toBe("rejected");
    expect(raw.rejectionReason).toBeTruthy();

    // Never flows into the normalized layer.
    expect(await t.db.select().from(practices)).toHaveLength(0);
    expect(await t.db.select().from(signals)).toHaveLength(0);
    expect(await t.db.select().from(evidence)).toHaveLength(0);
  });
});
