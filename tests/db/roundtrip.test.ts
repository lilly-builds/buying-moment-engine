import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../setup";
import { upsertPractice, upsertSignal } from "@/db/ingest";
import { evidence, signals } from "@/db/schema";

describe("data-layer round-trip", () => {
  let t: TestDb;
  beforeEach(async () => {
    t = await createTestDb();
  });
  afterEach(async () => {
    await t.close();
  });

  it("round-trips a practice + signal + evidence with source_url intact", async () => {
    const url = "https://boards.example.com/job/123";
    const practice = await upsertPractice(t.db, {
      name: "Georgia Dermatology",
      geoKey: "atlanta-ga",
      city: "Atlanta",
      state: "GA",
    });
    const [ev] = await t.db
      .insert(evidence)
      .values({
        sourceUrl: url,
        snippet: "Hiring 3 front-desk coordinators",
        confidence: "0.8",
        detectedAt: new Date("2026-07-01T00:00:00Z"),
      })
      .returning();
    const sig = await upsertSignal(t.db, {
      practiceId: practice.id,
      kind: "staffing_spike",
      evidenceId: ev.id,
      signalSource: "greenhouse",
    });

    const [row] = await t.db
      .select({ sourceUrl: evidence.sourceUrl })
      .from(signals)
      .innerJoin(evidence, eq(signals.evidenceId, evidence.id))
      .where(eq(signals.id, sig.id));

    expect(row.sourceUrl).toBe(url);
  });
});
