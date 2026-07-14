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
 *                 concurrent caller gets the row; the loser reads who holds it.
 *                 Runs BEFORE any HubSpot call, so a duplicate never reaches HubSpot.
 *                 Also SELF-HEALS a stale claim (see STUCK_SEND_TTL_MS) so a send that
 *                 crashed between claim and confirm/release never locks a lead forever.
 *   confirmSend — flip a held claim to `sent` once HubSpot confirms the enrollment.
 *                 Returns whether a row was actually updated so the caller can log a
 *                 silent 0-row miss instead of leaving a lead wrongly stuck 'sending'.
 *   releaseSend — delete a still-`sending` claim after a FAILED send, so the lead can
 *                 be retried and is never left falsely marked sent.
 *   getSendState — read the shared state for the page + button (null = never sent).
 *
 * Mirrors the idempotent-by-unique-key style of `db/crm.ts`.
 */

export type OutreachSendStatus = "sending" | "sent";

/**
 * A `sending` claim older than this is treated as ABANDONED and may be stolen by a new
 * claim (see `claimSend`). It must be comfortably LONGER than the longest possible real
 * send: the whole send runs inside ONE serverless request, bounded by the platform's
 * function timeout (at most a few minutes), so a `sending` row older than this can only
 * mean a request that was killed between claim and confirm/release — never a live
 * in-flight send. 15 minutes leaves a wide safety margin, so the self-heal can never
 * steal a claim out from under a send that is still running (which would double-send).
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
  | { ok: true }
  | { ok: false; existing: SendState };

/** The atomic reserve, factored out so the first claim and the post-steal retry share it. */
async function insertClaim(
  db: Database,
  practiceId: string,
  sentBy: string,
): Promise<boolean> {
  const [claimed] = await db
    .insert(outreachSends)
    .values({ practiceId, sentBy, status: "sending" })
    .onConflictDoNothing({ target: outreachSends.practiceId })
    .returning({ id: outreachSends.id });
  return Boolean(claimed);
}

/**
 * Atomically claim the send for a practice. The winner gets `{ ok: true }` and must
 * go on to confirm or release; every other concurrent caller gets `{ ok: false }`
 * with the existing record so the UI can say who holds it.
 */
export async function claimSend(
  db: Database,
  practiceId: string,
  sentBy: string,
): Promise<ClaimSendResult> {
  // 1. Atomic claim. Exactly one concurrent caller wins; a loser gets nothing back.
  if (await insertClaim(db, practiceId, sentBy)) return { ok: true };

  // 2. Conflict. If the holder is a STALE `sending` claim (older than the TTL) it is
  //    abandoned — a prior send killed between claim and confirm/release with no
  //    reconciler to free it. Clear it (age-guarded, so a genuinely in-flight RECENT
  //    claim is NEVER stolen) and retry the atomic claim once. Safe under a race: the
  //    delete is scoped to an OLD `sending` row and the retry is still
  //    ON-CONFLICT-DO-NOTHING, so two callers stealing at once still yield exactly ONE
  //    winner — no new double-send window opens. A confirmed `sent` row is never touched.
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
  if (stolen && (await insertClaim(db, practiceId, sentBy))) return { ok: true };

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
 * Flip a held claim to `sent` after HubSpot confirms the enrollment. Returns whether a
 * row was actually updated (via `.returning()`, the `db/crm.ts` "prove the write landed"
 * convention) so the caller can log loudly on a silent 0-row update instead of leaving a
 * row wrongly stuck `sending` with no signal.
 */
export async function confirmSend(
  db: Database,
  practiceId: string,
  sentAt: Date,
): Promise<boolean> {
  const [row] = await db
    .update(outreachSends)
    .set({ status: "sent", sentAt, updatedAt: sentAt })
    .where(eq(outreachSends.practiceId, practiceId))
    .returning({ id: outreachSends.id });
  return Boolean(row);
}

/**
 * Release a claim after a FAILED send so the lead can be retried. Only deletes a
 * still-`sending` row — never a confirmed `sent` one (belt-and-suspenders against a
 * release racing a confirm).
 */
export async function releaseSend(
  db: Database,
  practiceId: string,
): Promise<void> {
  await db
    .delete(outreachSends)
    .where(
      and(
        eq(outreachSends.practiceId, practiceId),
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
