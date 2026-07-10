import { and, desc, eq } from "drizzle-orm";
import type { Database } from "./types";
import { crmConnections, crmLinks } from "./schema";
import type { CrmLinkRef } from "@/src/crm/adapter";

/**
 * CRM data-layer helpers (R8, U10). Storage side of the adapter: per-tenant
 * OAuth connections (tokens stored ENCRYPTED by the caller) and the per-lead
 * `crm_links` row that makes pushes idempotent + feeds the ROI read-back.
 *
 * Idempotent by unique key throughout — re-connecting or re-pushing UPDATES,
 * never duplicates (mirrors `db/ingest.ts`). numeric columns are written as
 * strings (postgres numeric). No token plaintext ever lands here (D9).
 */

// ── OAuth connections ────────────────────────────────────────────────────────

export interface StoreConnectionArgs {
  provider?: string;
  portalId: string;
  accessTokenEnc: string;
  refreshTokenEnc: string;
  expiresAt: Date;
  scopes?: string | null;
  /** The connecting user's inbox (from OAuth token meta) — the address the send
   *  goes through. Refreshed on every (re)connect; leave undefined to not touch. */
  senderEmail?: string | null;
  /** The connecting user's HubSpot user id (from OAuth token meta) — the acting
   *  user for enrollment. Refreshed on every (re)connect; undefined = don't touch. */
  senderUserId?: string | null;
}

/**
 * Upsert a per-tenant connection on (provider, portal_id). Tokens/scopes/expiry
 * ALWAYS refresh (that's the point of a reconnect). The send-config columns are
 * touched only when provided: senderEmail/senderUserId ride the OAuth token meta
 * so they refresh on each connect, while sequence_id is set OUT OF BAND by the
 * capture endpoint — so a reconnect must NOT null a sequence the user already
 * pasted (mirrors `upsertCrmLink`'s "only overwrite what the caller provided").
 */
export async function storeConnection(
  db: Database,
  args: StoreConnectionArgs,
): Promise<void> {
  const provider = args.provider ?? "hubspot";
  await db
    .insert(crmConnections)
    .values({
      provider,
      portalId: args.portalId,
      accessTokenEnc: args.accessTokenEnc,
      refreshTokenEnc: args.refreshTokenEnc,
      expiresAt: args.expiresAt,
      scopes: args.scopes ?? null,
      senderEmail: args.senderEmail ?? null,
      senderUserId: args.senderUserId ?? null,
    })
    .onConflictDoUpdate({
      target: [crmConnections.provider, crmConnections.portalId],
      set: {
        accessTokenEnc: args.accessTokenEnc,
        refreshTokenEnc: args.refreshTokenEnc,
        expiresAt: args.expiresAt,
        scopes: args.scopes ?? null,
        ...(args.senderEmail !== undefined ? { senderEmail: args.senderEmail } : {}),
        ...(args.senderUserId !== undefined
          ? { senderUserId: args.senderUserId }
          : {}),
        updatedAt: new Date(),
      },
    });
}

export interface SetConnectionSendConfigArgs {
  portalId: string;
  provider?: string;
  sequenceId?: string;
  senderEmail?: string;
  senderUserId?: string;
}

/**
 * Set the per-connection send config on an EXISTING connection (the capture
 * endpoint: the user pastes their sequence id after finishing HubSpot sequence
 * setup). A targeted UPDATE — it never mints a row and never touches tokens.
 * Only the provided columns change. Returns whether a row matched, so the route
 * can prove the write landed on a real connection rather than assert success.
 */
export async function setConnectionSendConfig(
  db: Database,
  args: SetConnectionSendConfigArgs,
): Promise<{ updated: boolean }> {
  const provider = args.provider ?? "hubspot";
  const set: Partial<typeof crmConnections.$inferInsert> = { updatedAt: new Date() };
  if (args.sequenceId !== undefined) set.sequenceId = args.sequenceId;
  if (args.senderEmail !== undefined) set.senderEmail = args.senderEmail;
  if (args.senderUserId !== undefined) set.senderUserId = args.senderUserId;

  const rows = await db
    .update(crmConnections)
    .set(set)
    .where(
      and(
        eq(crmConnections.provider, provider),
        eq(crmConnections.portalId, args.portalId),
      ),
    )
    .returning({ id: crmConnections.id });
  return { updated: rows.length > 0 };
}

export type ConnectionRow = typeof crmConnections.$inferSelect;

export async function loadConnection(
  db: Database,
  portalId: string,
  provider = "hubspot",
): Promise<ConnectionRow | null> {
  const [row] = await db
    .select()
    .from(crmConnections)
    .where(
      and(
        eq(crmConnections.provider, provider),
        eq(crmConnections.portalId, portalId),
      ),
    )
    .limit(1);
  return row ?? null;
}

export type ActiveConnectionResult =
  | { ok: true; connection: ConnectionRow }
  | { ok: false; reason: "none" | "ambiguous" };

/**
 * Resolve the active connection for a provider SERVER-SIDE (U10 hardening). The
 * push path must NEVER take a caller-supplied portal id (IDOR) — it derives the
 * portal from the stored connection. This demo is single-tenant (one HubSpot
 * portal): 0 rows -> "none" (connect first), exactly 1 -> that row, and >1 is a
 * genuine ambiguity we refuse to guess through rather than pick a portal.
 */
export async function getActiveConnection(
  db: Database,
  provider = "hubspot",
): Promise<ActiveConnectionResult> {
  const rows = await db
    .select()
    .from(crmConnections)
    .where(eq(crmConnections.provider, provider))
    .orderBy(desc(crmConnections.updatedAt))
    .limit(2);
  if (rows.length === 0) return { ok: false, reason: "none" };
  if (rows.length > 1) return { ok: false, reason: "ambiguous" };
  return { ok: true, connection: rows[0] };
}

// ── Per-lead links ───────────────────────────────────────────────────────────

export interface UpsertCrmLinkArgs {
  practiceId: string;
  provider?: string;
  companyId?: string | null;
  contactId?: string | null;
  dealId?: string | null;
  stage?: string | null;
  stageChangedAt?: Date | null;
  cycleTimeDays?: number | null;
  leadQuality?: string | null;
  syncedAt?: Date | null;
}

/** Upsert the per-lead CRM link on (practice_id, provider) — idempotent push. */
export async function upsertCrmLink(
  db: Database,
  args: UpsertCrmLinkArgs,
): Promise<void> {
  const provider = args.provider ?? "hubspot";
  const cycle =
    args.cycleTimeDays === null || args.cycleTimeDays === undefined
      ? null
      : String(args.cycleTimeDays);
  await db
    .insert(crmLinks)
    .values({
      practiceId: args.practiceId,
      provider,
      companyId: args.companyId ?? null,
      contactId: args.contactId ?? null,
      dealId: args.dealId ?? null,
      stage: args.stage ?? null,
      stageChangedAt: args.stageChangedAt ?? null,
      cycleTimeDays: cycle,
      leadQuality: args.leadQuality ?? null,
      syncedAt: args.syncedAt ?? null,
    })
    .onConflictDoUpdate({
      target: [crmLinks.practiceId, crmLinks.provider],
      // Only overwrite columns the caller actually provided, so a stage-only
      // update never nulls out the stored company/contact/deal ids.
      set: {
        ...(args.companyId !== undefined ? { companyId: args.companyId } : {}),
        ...(args.contactId !== undefined ? { contactId: args.contactId } : {}),
        ...(args.dealId !== undefined ? { dealId: args.dealId } : {}),
        ...(args.stage !== undefined ? { stage: args.stage } : {}),
        ...(args.stageChangedAt !== undefined
          ? { stageChangedAt: args.stageChangedAt }
          : {}),
        ...(args.cycleTimeDays !== undefined ? { cycleTimeDays: cycle } : {}),
        ...(args.leadQuality !== undefined
          ? { leadQuality: args.leadQuality }
          : {}),
        ...(args.syncedAt !== undefined ? { syncedAt: args.syncedAt } : {}),
        updatedAt: new Date(),
      },
    });
}

export async function loadCrmLink(
  db: Database,
  practiceId: string,
  provider = "hubspot",
): Promise<CrmLinkRef | null> {
  const [row] = await db
    .select({
      companyId: crmLinks.companyId,
      contactId: crmLinks.contactId,
      dealId: crmLinks.dealId,
    })
    .from(crmLinks)
    .where(
      and(
        eq(crmLinks.practiceId, practiceId),
        eq(crmLinks.provider, provider),
      ),
    )
    .limit(1);
  return row ?? null;
}

export interface CycleTimeReadback {
  stage: string | null;
  cycleTimeDays: number | null;
}

/** ROI read-back the scoreboard consumes (U12): stage + cycle time per lead. */
export async function roiCycleTimeReadback(
  db: Database,
  practiceId: string,
  provider = "hubspot",
): Promise<CycleTimeReadback | null> {
  const [row] = await db
    .select({ stage: crmLinks.stage, cycleTimeDays: crmLinks.cycleTimeDays })
    .from(crmLinks)
    .where(
      and(
        eq(crmLinks.practiceId, practiceId),
        eq(crmLinks.provider, provider),
      ),
    )
    .limit(1);
  if (!row) return null;
  return {
    stage: row.stage,
    cycleTimeDays: row.cycleTimeDays === null ? null : Number(row.cycleTimeDays),
  };
}
