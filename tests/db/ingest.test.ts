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

  it("promotes a source-provided website onto the practice (R-W1)", async () => {
    const withSite = {
      ...validSignal,
      dedupeHash: "hash-site",
      payload: { ...validSignal.payload, website: "https://sunshinederm.com" },
    };
    const res = await ingestRawSignal(t.db, withSite);
    expect(res.status).toBe("ingested");
    const [practice] = await t.db.select().from(practices);
    expect(practice.websiteUrl).toBe("https://sunshinederm.com");
  });

  it("leaves website_url null when the payload has no website (no regression)", async () => {
    const res = await ingestRawSignal(t.db, validSignal);
    expect(res.status).toBe("ingested");
    const [practice] = await t.db.select().from(practices);
    expect(practice.websiteUrl).toBeNull();
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

  it("the fallback dedupe hash is KEY-ORDER-INDEPENDENT (U5)", async () => {
    // Same payload, keys emitted in a different order, and NO explicit dedupeHash.
    const a = {
      detectorKind: "staffing_spike",
      payload: { snippet: "Hiring", confidence: 0.9 },
      sourceUrl: "https://boards.example.com/job/7",
      practiceHint: "Sunshine Dermatology",
      detectedAt: "2026-07-01T00:00:00Z",
      geoKey: "tampa-fl",
    };
    const b = {
      geoKey: "tampa-fl",
      detectedAt: "2026-07-01T00:00:00Z",
      practiceHint: "Sunshine Dermatology",
      sourceUrl: "https://boards.example.com/job/7",
      payload: { confidence: 0.9, snippet: "Hiring" },
      detectorKind: "staffing_spike",
    };

    expect((await ingestRawSignal(t.db, a)).status).toBe("ingested");
    expect((await ingestRawSignal(t.db, b)).status).toBe("duplicate");
    expect(await t.db.select().from(rawSignals)).toHaveLength(1);
  });
});
