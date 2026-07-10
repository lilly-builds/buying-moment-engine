import {
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, updatedAt } from "./columns";
import { practices } from "./entities";

/**
 * CRM domain — AE lead-quality feedback (R13) and the CRM link/track records (R8).
 */

export const feedbackThumb = pgEnum("feedback_thumb", ["up", "down"]);

export const feedbackReason = pgEnum("feedback_reason", [
  "too_small",
  "wrong_specialty",
  "already_customer",
  "bad_timing",
]);

export const feedback = pgTable(
  "feedback",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    practiceId: uuid("practice_id")
      .notNull()
      .references(() => practices.id),
    aeEmail: text("ae_email").notNull(),
    thumb: feedbackThumb("thumb").notNull(),
    reason: feedbackReason("reason"),
    freeText: text("free_text"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  // A re-vote UPDATES the existing row, never duplicates (R13).
  (t) => [unique("feedback_practice_ae_uq").on(t.practiceId, t.aeEmail)],
).enableRLS();

export const crmLinks = pgTable(
  "crm_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    practiceId: uuid("practice_id")
      .notNull()
      .references(() => practices.id),
    provider: text("provider").notNull().default("hubspot"),
    companyId: text("company_id"),
    contactId: text("contact_id"),
    dealId: text("deal_id"),
    stage: text("stage"),
    stageChangedAt: timestamp("stage_changed_at", { withTimezone: true }),
    cycleTimeDays: numeric("cycle_time_days"),
    // First-class lead-quality tag (R17).
    leadQuality: text("lead_quality"),
    syncedAt: timestamp("synced_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [unique("crm_links_practice_provider_uq").on(t.practiceId, t.provider)],
).enableRLS();

/**
 * crm_connections (R8, U10) — per-tenant OAuth tokens for the CRM binding. ONE
 * "Connect HubSpot" grant per portal covers CRM + send + analytics. Tokens are
 * stored ENCRYPTED at rest (AES-256-GCM via `src/crm/token-crypto.ts`); the
 * plaintext token never touches a column and is never logged (D9). The access
 * token is short-lived (~30 min) and refreshed proactively off `expires_at`;
 * the refresh token is long-lived. Per-tenant keying is (provider, portal_id) —
 * HubSpot's hub/portal id identifies the connected account.
 */
export const crmConnections = pgTable(
  "crm_connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    provider: text("provider").notNull().default("hubspot"),
    // Tenant key: the HubSpot portal/hub id the grant belongs to.
    portalId: text("portal_id").notNull(),
    // AES-256-GCM ciphertext — NEVER plaintext, NEVER logged (D9).
    accessTokenEnc: text("access_token_enc").notNull(),
    refreshTokenEnc: text("refresh_token_enc").notNull(),
    // When the ACCESS token expires — drives proactive refresh.
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    // Space-delimited granted scopes (audit which capabilities this grant covers).
    scopes: text("scopes"),
    // ── Per-connection SEND config (the sequence/inbox this portal sends through) ──
    // Each connected portal runs its OWN dynamic sequence, its OWN connected inbox,
    // and its OWN HubSpot user — so send config is per-tenant, NOT a global env var.
    // sequenceId is captured by paste during onboarding (HubSpot has no create/list-
    // sequence API — enrollment-only); senderEmail + senderUserId auto-capture from
    // the OAuth token metadata at connect. All nullable until sequence setup finishes
    // — a connection with no sequenceId can't send yet (the gate shows the RevOps
    // handoff, never a Send that 503s). The D9 sandbox allowlist stays env (the
    // firewall, not per-tenant data).
    sequenceId: text("sequence_id"),
    senderEmail: text("sender_email"),
    senderUserId: text("sender_user_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  // One connection per (provider, portal) — re-connecting UPDATES, never dupes.
  (t) => [
    unique("crm_connections_provider_portal_uq").on(t.provider, t.portalId),
  ],
).enableRLS();
