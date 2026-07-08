import { and, eq } from "drizzle-orm";
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
}

/** Upsert a per-tenant connection on (provider, portal_id). */
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
    })
    .onConflictDoUpdate({
      target: [crmConnections.provider, crmConnections.portalId],
      set: {
        accessTokenEnc: args.accessTokenEnc,
        refreshTokenEnc: args.refreshTokenEnc,
        expiresAt: args.expiresAt,
        scopes: args.scopes ?? null,
        updatedAt: new Date(),
      },
    });
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
