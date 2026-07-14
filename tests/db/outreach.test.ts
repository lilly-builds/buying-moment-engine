import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { outreachSends } from "@/db/schema";
import { upsertPractice } from "@/db/ingest";
import {
  claimSend,
  confirmSend,
  releaseSend,
  getSendState,
  STUCK_SEND_TTL_MS,
} from "@/db/outreach";
import { createTestDb, type TestDb } from "../setup";

/**
 * Outreach send-state data layer (U11 shared-workspace double-send guard). These lock
 * the partial-failure recovery paths that cannot be exercised against live HubSpot: the
 * atomic claim, the write-verified confirm, and the stale-claim TTL self-heal that stops
 * a crashed send from locking a lead forever.
 */

async function seedPractice(tdb: TestDb, geoKey: string): Promise<string> {
  const practice = await upsertPractice(tdb.db, {
    name: "Test Practice",
    geoKey,
    city: "Austin",
    state: "TX",
    vertical: "dermatology",
  });
  return practice.id;
}

describe("outreach send-state (U11)", () => {
  let tdb: TestDb;
  beforeEach(async () => {
    tdb = await createTestDb();
  });

  it("claimSend: exactly one of two concurrent claims wins; the loser sees the holder", async () => {
    const practiceId = await seedPractice(tdb, "demo:one");
    const first = await claimSend(tdb.db, practiceId, "ae1@opterra.test");
    const second = await claimSend(tdb.db, practiceId, "ae2@opterra.test");

    expect(first).toEqual({ ok: true });
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.existing.status).toBe("sending");
      expect(second.existing.sentBy).toBe("ae1@opterra.test");
    }
  });

  it("releaseSend frees a still-'sending' claim so the lead can be re-claimed", async () => {
    const practiceId = await seedPractice(tdb, "demo:two");
    await claimSend(tdb.db, practiceId, "ae1@opterra.test");
    await releaseSend(tdb.db, practiceId);

    expect(await getSendState(tdb.db, practiceId)).toBeNull();
    // Re-claim by a different AE now succeeds.
    expect(await claimSend(tdb.db, practiceId, "ae2@opterra.test")).toEqual({ ok: true });
  });

  it("confirmSend flips to 'sent' and reports the row was updated", async () => {
    const practiceId = await seedPractice(tdb, "demo:three");
    await claimSend(tdb.db, practiceId, "ae1@opterra.test");
    const when = new Date();

    expect(await confirmSend(tdb.db, practiceId, when)).toBe(true);
    const state = await getSendState(tdb.db, practiceId);
    expect(state?.status).toBe("sent");
    expect(state?.sentAt).not.toBeNull();
  });

  it("confirmSend returns false when there is no claim row to flip (the silent-miss signal)", async () => {
    const practiceId = await seedPractice(tdb, "demo:four");
    // No claim exists, so the update matches zero rows.
    expect(await confirmSend(tdb.db, practiceId, new Date())).toBe(false);
  });

  it("releaseSend never deletes a confirmed 'sent' row", async () => {
    const practiceId = await seedPractice(tdb, "demo:five");
    await claimSend(tdb.db, practiceId, "ae1@opterra.test");
    await confirmSend(tdb.db, practiceId, new Date());
    await releaseSend(tdb.db, practiceId);

    expect((await getSendState(tdb.db, practiceId))?.status).toBe("sent");
  });

  it("claimSend self-heals: a STALE 'sending' claim (older than the TTL) is stolen", async () => {
    const practiceId = await seedPractice(tdb, "demo:stale");
    // Simulate a send that crashed after claiming: a 'sending' row older than the TTL.
    await tdb.db.insert(outreachSends).values({
      practiceId,
      sentBy: "crashed@opterra.test",
      status: "sending",
      createdAt: new Date(Date.now() - STUCK_SEND_TTL_MS - 60_000),
    });

    const claim = await claimSend(tdb.db, practiceId, "ae2@opterra.test");
    expect(claim).toEqual({ ok: true });
    // The new AE now holds a fresh claim (the abandoned one was replaced, not duplicated).
    const [rows] = await tdb.db
      .select({ sentBy: outreachSends.sentBy })
      .from(outreachSends)
      .where(eq(outreachSends.practiceId, practiceId));
    expect(rows.sentBy).toBe("ae2@opterra.test");
  });

  it("claimSend does NOT steal a RECENT 'sending' claim (no double-send window)", async () => {
    const practiceId = await seedPractice(tdb, "demo:fresh");
    await claimSend(tdb.db, practiceId, "ae1@opterra.test"); // fresh, created just now

    const claim = await claimSend(tdb.db, practiceId, "ae2@opterra.test");
    expect(claim.ok).toBe(false);
    if (!claim.ok) expect(claim.existing.sentBy).toBe("ae1@opterra.test");
  });
});
