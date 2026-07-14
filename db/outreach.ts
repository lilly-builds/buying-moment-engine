import { and, eq } from "drizzle-orm";
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
 *   confirmSend — flip a held claim to `sent` once HubSpot confirms the enrollment.
 *   releaseSend — delete a still-`sending` claim after a FAILED send, so the lead can
 *                 be retried and is never left falsely marked sent.
 *   getSendState — read the shared state for the page + button (null = never sent).
 *
 * Mirrors the idempotent-by-unique-key style of `db/crm.ts`.
 */

export type OutreachSendStatus = "sending" | "sent";

export interface SendState {
  status: OutreachSendStatus;
  /** The allowlisted session email that clicked Send. */
  sentBy: string;
  /** When it flipped to `sent`; null while still `sending`. */
  sentAt: Date | null;
}

export type ClaimSendResult =
  | { ok: true }
  | { ok: false; existing: SendState };

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
  const [claimed] = await db
    .insert(outreachSends)
    .values({ practiceId, sentBy, status: "sending" })
    .onConflictDoNothing({ target: outreachSends.practiceId })
    .returning({ id: outreachSends.id });

  if (claimed) return { ok: true };

  // Conflict: a row already exists. Read it so the caller can report who holds it.
  const existing = await getSendState(db, practiceId);
  return {
    ok: false,
    // Defensive: if the row was released between the insert and this read (a rare
    // concurrent retry), report a generic in-flight state rather than crash.
    existing: existing ?? { status: "sending", sentBy: "another user", sentAt: null },
  };
}

/** Flip a held claim to `sent` after HubSpot confirms the enrollment. */
export async function confirmSend(
  db: Database,
  practiceId: string,
  sentAt: Date,
): Promise<void> {
  await db
    .update(outreachSends)
    .set({ status: "sent", sentAt, updatedAt: sentAt })
    .where(eq(outreachSends.practiceId, practiceId));
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
    })
    .from(outreachSends)
    .where(eq(outreachSends.practiceId, practiceId))
    .limit(1);
  return row ?? null;
}
