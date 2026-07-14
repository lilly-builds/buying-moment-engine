import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../setup";
import { recordFeedback } from "@/db/feedback";
import { upsertPractice } from "@/db/ingest";
import { feedback } from "@/db/schema";

/**
 * AE lead-quality feedback persistence (COV-11 / R13). The route was a stub; this is the
 * real write path. A re-vote by the same AE must UPDATE the existing row, never duplicate
 * (the `feedback_practice_ae_uq` constraint).
 */

describe("recordFeedback", () => {
  let t: TestDb;
  beforeEach(async () => {
    t = await createTestDb();
  });
  afterEach(async () => {
    await t.close();
  });

  async function seedPractice() {
    const p = await upsertPractice(t.db, {
      name: "Georgia Dermatology",
      geoKey: "atlanta-ga",
      city: "Atlanta",
      state: "GA",
    });
    return p.id;
  }

  it("persists a thumb vote with the AE email", async () => {
    const practiceId = await seedPractice();
    await recordFeedback(t.db, { practiceId, aeEmail: "ae@opterra.com", thumb: "up" });

    const rows = await t.db.select().from(feedback);
    expect(rows).toHaveLength(1);
    expect(rows[0].thumb).toBe("up");
    expect(rows[0].aeEmail).toBe("ae@opterra.com");
  });

  it("updates the same AE's vote instead of duplicating it", async () => {
    const practiceId = await seedPractice();
    await recordFeedback(t.db, { practiceId, aeEmail: "ae@opterra.com", thumb: "up" });
    await recordFeedback(t.db, {
      practiceId,
      aeEmail: "ae@opterra.com",
      thumb: "down",
      reason: "bad_timing",
    });

    const rows = await t.db.select().from(feedback);
    expect(rows).toHaveLength(1);
    expect(rows[0].thumb).toBe("down");
    expect(rows[0].reason).toBe("bad_timing");
  });

  it("preserves a stored reason/freeText when a later thumb-only re-vote omits them", async () => {
    const practiceId = await seedPractice();
    await recordFeedback(t.db, {
      practiceId,
      aeEmail: "ae@opterra.com",
      thumb: "down",
      reason: "bad_timing",
      freeText: "call back in Q3",
    });
    // A thumb-only re-vote (no reason/freeText) must not erase the earlier context.
    await recordFeedback(t.db, { practiceId, aeEmail: "ae@opterra.com", thumb: "up" });

    const [row] = await t.db.select().from(feedback);
    expect(row.thumb).toBe("up");
    expect(row.reason).toBe("bad_timing");
    expect(row.freeText).toBe("call back in Q3");
  });

  it("clears a stored reason when the caller explicitly passes null", async () => {
    const practiceId = await seedPractice();
    await recordFeedback(t.db, { practiceId, aeEmail: "ae@opterra.com", thumb: "down", reason: "too_small" });
    await recordFeedback(t.db, { practiceId, aeEmail: "ae@opterra.com", thumb: "down", reason: null });

    const [row] = await t.db.select().from(feedback);
    expect(row.reason).toBeNull();
  });

  it("keeps two different AEs' votes on the same practice as separate rows", async () => {
    const practiceId = await seedPractice();
    await recordFeedback(t.db, { practiceId, aeEmail: "a@opterra.com", thumb: "up" });
    await recordFeedback(t.db, { practiceId, aeEmail: "b@opterra.com", thumb: "down" });

    const rows = await t.db.select().from(feedback);
    expect(rows).toHaveLength(2);
    const mine = await t.db
      .select()
      .from(feedback)
      .where(and(eq(feedback.practiceId, practiceId), eq(feedback.aeEmail, "a@opterra.com")));
    expect(mine[0].thumb).toBe("up");
  });
});
