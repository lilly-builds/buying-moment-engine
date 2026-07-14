import { and, eq, lt } from "drizzle-orm";
import type { Database } from "./types";
import { outreachSends } from "./schema";

/**
 * Outreach send-state data layer — the shared "Sent" record for a practice.
 *
 * The dashboard is a single shared workspace (no per-user data — see
 * `src/discovery/tenants.ts`), so this table is what stops two AEs from sending the
 * same lead twice. The pattern is claim → confirm/release, all keyed by the unique
 * `practice_id`:
 *
 *   claimSend   — atomic reserve. INSERT ... ON CONFLICT DO NOTHING: exactly ONE
 *                 concurrent caller gets the row (and its id); the loser reads who
 *                 holds it. Runs BEFORE any HubSpot call, so a duplicate never reaches
 *                 HubSpot. Also SELF-HEALS a stale claim (see STUCK_SEND_TTL_MS) so a
 *                 send that crashed between claim and confirm/release never locks a
 *                 lead forever. The winner gets back its claim `id` and MUST pass it to
 *                 confirmSend / releaseSend so those act on ITS OWN claim, never a later
 *                 claim that replaced it.
 *   confirmSend — flip the caller's OWN claim (by id) to `sent` once HubSpot confirms.
 *                 Returns whether a row was actually updated so the caller can log a
 *                 silent 0-row miss instead of leaving a lead wrongly stuck 'sending'.
 *   releaseSend — delete the caller's OWN still-`sending` claim (by id) after a FAILED
 *                 send, so the lead can be retried and is never left falsely marked sent.
 *   getSendState — read the shared state for the page + button (null = never sent).
 *
 * Mirrors the idempotent-by-unique-key style of `db/crm.ts`.
 */

export type OutreachSendStatus = "sending" | "sent";

/**
 * A `sending` claim older than this is treated as ABANDONED and may be stolen by a new
 * claim (see `claimSend`). It should sit well past a normal send's duration so the steal
 * only ever hits a crashed/killed request, not a healthy in-flight one.
 *
 * The no-DUPLICATE-EMAIL guarantee does NOT rest on this bound: even if a slow send (e.g.
 * a long 429-backoff chain, since `/api/send` sets no maxDuration) outlived the TTL and
 * had its claim stolen, HubSpot rejects the second enrollment (CONTACT_ALREADY_ENROLLED),
 * so at most one email ever leaves. And confirm/release act on the caller's OWN claim id,
 * so a steal can never corrupt the new holder's state either. The TTL is purely a
 * lock-recovery convenience, not the correctness guarantee.
 */
export const STUCK_SEND_TTL_MS = 15 * 60 * 1000;

export interface SendState {
  status: OutreachSendStatus;
  /** The allowlisted session email that clicked Send. */
  sentBy: string;
  /** When it flipped to `sent`; null while still `sending`. */
  sentAt: Date | null;
  /** When the claim was created — its age is what marks a stuck `sending` abandoned. */
  createdAt: Date;
}

export type ClaimSendResult =
  | { ok: true; id: string }
  | { ok: false; existing: SendState };

/**
 * The atomic reserve, factored out so the first claim and the post-steal retry share it.
 * Returns the new claim's id on success, or null when another caller already holds it.
 */
async function insertClaim(
  db: Database,
  practiceId: string,
  sentBy: string,
): Promise<string | null> {
  const [claimed] = await db
    .insert(outreachSends)
    .values({ practiceId, sentBy, status: "sending" })
    .onConflictDoNothing({ target: outreachSends.practiceId })
    .returning({ id: outreachSends.id });
  return claimed?.id ?? null;
}

/**
 * Atomically claim the send for a practice. The winner gets `{ ok: true, id }` and must
 * pass that id to confirmSend / releaseSend; every other concurrent caller gets
 * `{ ok: false }` with the existing record so the UI can say who holds it.
 */
export async function claimSend(
  db: Database,
  practiceId: string,
  sentBy: string,
): Promise<ClaimSendResult> {
  // 1. Atomic claim. Exactly one concurrent caller wins and gets the row id.
  const id = await insertClaim(db, practiceId, sentBy);
  if (id) return { ok: true, id };

  // 2. Conflict. If the holder is a STALE `sending` claim (older than the TTL) it is
  //    abandoned — a prior send killed between claim and confirm/release with no
  //    reconciler to free it. Clear it (age-guarded, so a genuinely in-flight RECENT
  //    claim is NEVER stolen) and retry the atomic claim once. Safe under a race: the
  //    delete row-locks the stale row so only ONE caller's delete returns it, and the
  //    retry is still ON CONFLICT DO NOTHING, so two callers stealing at once still
  //    yield exactly ONE winner. A confirmed `sent` row is never touched.
  const cutoff = new Date(Date.now() - STUCK_SEND_TTL_MS);
  const [stolen] = await db
    .delete(outreachSends)
    .where(
      and(
        eq(outreachSends.practiceId, practiceId),
        eq(outreachSends.status, "sending"),
        lt(outreachSends.createdAt, cutoff),
      ),
    )
    .returning({ id: outreachSends.id });
  if (stolen) {
    const retryId = await insertClaim(db, practiceId, sentBy);
    if (retryId) return { ok: true, id: retryId };
  }

  // 3. A LIVE claim holds it (a recent `sending`, or a confirmed `sent`). Report who.
  const existing = await getSendState(db, practiceId);
  return {
    ok: false,
    // Defensive: if the row was released between the insert and this read (a rare
    // concurrent retry), report a generic in-flight state rather than crash.
    existing: existing ?? {
      status: "sending",
      sentBy: "another user",
      sentAt: null,
      createdAt: new Date(),
    },
  };
}

/**
 * Flip the caller's OWN claim (by id) to `sent` after HubSpot confirms the enrollment.
 * Scoping to the claim id — not just the practice — means a late confirm from a send
 * whose claim was already stolen updates ZERO rows instead of corrupting the new holder's
 * claim. Returns whether a row was actually updated (the `db/crm.ts` "prove the write
 * landed" convention) so the caller can log a silent 0-row miss.
 */
export async function confirmSend(
  db: Database,
  claimId: string,
  sentAt: Date,
): Promise<boolean> {
  const [row] = await db
    .update(outreachSends)
    .set({ status: "sent", sentAt, updatedAt: sentAt })
    .where(eq(outreachSends.id, claimId))
    .returning({ id: outreachSends.id });
  return Boolean(row);
}

/**
 * Release the caller's OWN claim (by id) after a FAILED send so the lead can be retried.
 * Scoped to the claim id AND `status = 'sending'`: it can only ever delete the exact row
 * this caller claimed, and never a confirmed `sent` one (belt-and-suspenders against a
 * release racing a confirm, or a claim that was already stolen and replaced).
 */
export async function releaseSend(
  db: Database,
  claimId: string,
): Promise<void> {
  await db
    .delete(outreachSends)
    .where(
      and(
        eq(outreachSends.id, claimId),
        eq(outreachSends.status, "sending"),
      ),
    );
}

/** Read the shared send state for a practice (null = never sent). */
export async function getSendState(
  db: Database,
  practiceId: string,
): Promise<SendState | null> {
  const [row] = await db
    .select({
      status: outreachSends.status,
      sentBy: outreachSends.sentBy,
      sentAt: outreachSends.sentAt,
      createdAt: outreachSends.createdAt,
    })
    .from(outreachSends)
    .where(eq(outreachSends.practiceId, practiceId))
    .limit(1);
  return row ?? null;
}
