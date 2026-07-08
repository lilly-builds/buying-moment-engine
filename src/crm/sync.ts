import type { Database } from "@/db/types";
import { roiEvents } from "@/db/schema";
import {
  getActiveConnection,
  loadCrmLink,
  loadConnection,
  roiCycleTimeReadback,
  storeConnection,
  upsertCrmLink,
} from "@/db/crm";
import type {
  CrmAdapter,
  LeadInput,
  PushResult,
  StageReadback,
} from "./adapter";
import { createHubSpotAdapter } from "./hubspot";
import { ensureLeadProperties } from "./hubspot-properties";
import { INITIAL_DEAL_STAGE_ID, stageMilestone } from "./stages";
import { decrypt, encrypt } from "./token-crypto";
import {
  exchangeCodeForTokens,
  expiresAtFromExpiresIn,
  fetchTokenMeta,
  hasSendScope,
  refreshAccessToken,
  shouldRefresh,
  type OAuthHttpDeps,
} from "./hubspot-oauth";

/**
 * CRM orchestrators (R8, U10) — the flows that tie the DB, the adapter, the
 * OAuth token lifecycle, and the ROI event log together. Route handlers stay
 * thin (auth + parse + call one of these); the flows are unit-tested against
 * PGlite + a mocked HubSpot fetch, so the live swap in U15 is trivial.
 *
 * Tokens are ENCRYPTED before they touch the DB and decrypted only in-process
 * to make a call — never logged, never returned to a client (D9).
 */

const DEFAULT_PROVIDER = "hubspot";

// ── OAuth connect (callback → stored encrypted connection) ───────────────────

export interface ConnectOptions {
  code: string;
  encryptionKey: Buffer;
  provider?: string;
  now?: () => Date;
}

export interface ConnectResult {
  portalId: string;
  scopes: string;
  /** True when the granted scopes include Sequences enrollment (U9/U11 gate). */
  canSend: boolean;
}

/**
 * Complete the OAuth connect: exchange the `?code`, look up the portal id, store
 * the tokens ENCRYPTED (keyed per-tenant by provider + portal_id), and provision
 * the four tag properties so the very first `pushLead` can land.
 *
 * Property provisioning is part of CONNECT, not of push: HubSpot 400s a write to
 * a property that does not exist, so a connect that skipped this would hand the
 * AE a CRM integration that fails on its first real lead.
 */
export async function completeHubSpotConnect(
  db: Database,
  deps: OAuthHttpDeps,
  opts: ConnectOptions,
): Promise<ConnectResult> {
  const provider = opts.provider ?? DEFAULT_PROVIDER;
  const now = opts.now?.() ?? new Date();

  const tokens = await exchangeCodeForTokens(deps, opts.code);
  const meta = await fetchTokenMeta(deps, tokens.accessToken);
  const scopes = meta.scopes.join(" ");

  await storeConnection(db, {
    provider,
    portalId: meta.hubId,
    accessTokenEnc: encrypt(tokens.accessToken, opts.encryptionKey),
    refreshTokenEnc: encrypt(tokens.refreshToken, opts.encryptionKey),
    expiresAt: expiresAtFromExpiresIn(tokens.expiresIn, now),
    scopes,
  });

  // Idempotent: an already-provisioned portal answers 409 and we move on. The
  // freshly-exchanged access token is valid for ~30 min, so no refresh needed.
  await ensureLeadProperties({
    fetch: deps.fetch,
    getAccessToken: async () => tokens.accessToken,
    baseUrl: deps.baseUrl,
  });

  return { portalId: meta.hubId, scopes, canSend: hasSendScope(meta.scopes) };
}

/**
 * Whether the stored connection may drive the send path (R10). Reads GRANTED
 * scopes, so a portal that installed without Sales Hub Pro reports `canSend:
 * false` and the UI shows the honest gated state instead of 403-ing at send.
 */
export async function sendReadiness(
  db: Database,
  provider = DEFAULT_PROVIDER,
): Promise<{ connected: boolean; canSend: boolean }> {
  const active = await getActiveConnection(db, provider);
  if (!active.ok) return { connected: false, canSend: false };
  return { connected: true, canSend: hasSendScope(active.connection.scopes) };
}

// ── Access-token provider (proactive refresh) ────────────────────────────────

export interface TokenProviderOptions {
  portalId: string;
  encryptionKey: Buffer;
  provider?: string;
  now?: () => Date;
  skewMs?: number;
}

/**
 * A `getAccessToken` for the HubSpot adapter that refreshes PROACTIVELY: if the
 * stored access token is within the skew window of expiry, it trades the refresh
 * token for a new one, re-encrypts + persists it, and returns the fresh token —
 * otherwise it returns the current one. This is the "expired token → one refresh
 * → retry" path the adapter never has to think about.
 */
export function createDbTokenProvider(
  db: Database,
  deps: OAuthHttpDeps,
  opts: TokenProviderOptions,
): () => Promise<string> {
  const provider = opts.provider ?? DEFAULT_PROVIDER;
  return async () => {
    const conn = await loadConnection(db, opts.portalId, provider);
    if (!conn) {
      throw new Error(`no ${provider} connection for portal ${opts.portalId}`);
    }
    const now = opts.now?.() ?? new Date();
    if (!shouldRefresh(conn.expiresAt, now, opts.skewMs)) {
      return decrypt(conn.accessTokenEnc, opts.encryptionKey);
    }
    const refreshToken = decrypt(conn.refreshTokenEnc, opts.encryptionKey);
    const tokens = await refreshAccessToken(deps, refreshToken);
    await storeConnection(db, {
      provider,
      portalId: opts.portalId,
      accessTokenEnc: encrypt(tokens.accessToken, opts.encryptionKey),
      refreshTokenEnc: encrypt(tokens.refreshToken, opts.encryptionKey),
      expiresAt: expiresAtFromExpiresIn(tokens.expiresIn, now),
      scopes: conn.scopes,
    });
    return tokens.accessToken;
  };
}

// ── Lead push / tag / stage flows ────────────────────────────────────────────

export interface PushPracticeLeadArgs {
  practiceId: string;
  lead: LeadInput;
  provider?: string;
}

/**
 * Push a practice's lead through the adapter, persist the resulting ids to
 * `crm_links` (idempotency key), and log a `lead_pushed` ROI event. Re-running
 * with the same practiceId UPDATES the same records (the stored ids are passed
 * back into the adapter), never duplicates.
 */
export async function pushPracticeLead(
  db: Database,
  adapter: CrmAdapter,
  args: PushPracticeLeadArgs,
): Promise<PushResult> {
  const provider = args.provider ?? DEFAULT_PROVIDER;
  const existing = await loadCrmLink(db, args.practiceId, provider);

  // Persist ids AS EACH object lands, so a hard failure mid-sequence (a non-429
  // 5xx, or a 429 that exhausts retries) leaves a partial link that the next
  // sync UPDATES instead of re-creating a duplicate company (R8 idempotency).
  const result = await adapter.pushLead(args.lead, existing, (ref) =>
    upsertCrmLink(db, {
      practiceId: args.practiceId,
      provider,
      companyId: ref.companyId,
      contactId: ref.contactId,
      dealId: ref.dealId,
    }),
  );

  await upsertCrmLink(db, {
    practiceId: args.practiceId,
    provider,
    companyId: result.companyId,
    contactId: result.contactId,
    dealId: result.dealId,
    leadQuality: args.lead.tags.aeQuality ?? null,
    // Record the stage the deal was CREATED in, so the first `recordStage` poll
    // sees no transition. Without this, every pushed lead would immediately look
    // like a stage change into HubSpot's first stage and log a phantom
    // `meeting_booked` (see `stages.ts` — the default pipeline's first stage is
    // "Appointment Scheduled").
    stage: INITIAL_DEAL_STAGE_ID,
    syncedAt: new Date(),
  });

  // Log lead_pushed ONLY on a create — an idempotent re-sync of an
  // already-landed lead (created:false) must not log a second lead_pushed,
  // which would over-count the ROI number R8 measures.
  // KNOWN RESIDUAL (U12): a partial first push then a successful retry can
  // UNDER-log by one; the complete fix is a DB uniqueness constraint on the
  // ROI event, deferred to U12.
  if (result.created) {
    await db.insert(roiEvents).values({
      eventType: "lead_pushed",
      practiceId: args.practiceId,
      vertical: args.lead.tags.vertical,
      payload: {
        companyId: result.companyId,
        contactId: result.contactId,
        dealId: result.dealId,
        created: result.created,
      },
    });
  }

  return result;
}

export interface SyncPracticeLeadArgs {
  practiceId: string;
  lead: LeadInput;
  encryptionKey: Buffer;
  provider?: string;
}

export type SyncPracticeLeadResult =
  | { ok: true; result: PushResult }
  | { ok: false; status: number; error: string };

/**
 * Route-level push orchestrator (U10 hardening). Resolves the target HubSpot
 * connection SERVER-SIDE (never from request input — closes the IDOR where a
 * caller could pass an arbitrary portal id), binds a proactively-refreshing
 * token provider to it, and pushes the lead. Returns a status the route maps to
 * an HTTP response.
 */
export async function syncPracticeLead(
  db: Database,
  deps: OAuthHttpDeps,
  args: SyncPracticeLeadArgs,
): Promise<SyncPracticeLeadResult> {
  const provider = args.provider ?? DEFAULT_PROVIDER;
  const active = await getActiveConnection(db, provider);
  if (!active.ok) {
    return active.reason === "none"
      ? { ok: false, status: 409, error: "No HubSpot connection — connect HubSpot first" }
      : { ok: false, status: 503, error: "Multiple HubSpot connections — cannot resolve one" };
  }

  const getAccessToken = createDbTokenProvider(db, deps, {
    portalId: active.connection.portalId, // server-resolved, not client-supplied
    encryptionKey: args.encryptionKey,
    provider,
  });
  const adapter = createHubSpotAdapter({ fetch: deps.fetch, getAccessToken });
  const result = await pushPracticeLead(db, adapter, {
    practiceId: args.practiceId,
    lead: args.lead,
    provider,
  });
  return { ok: true, result };
}

export interface SyncLeadQualityArgs {
  practiceId: string;
  aeQuality: string;
  provider?: string;
}

/** Sync the AE's 👍/👎 verdict (ae_quality) to the CRM records + the link row. */
export async function syncLeadQuality(
  db: Database,
  adapter: CrmAdapter,
  args: SyncLeadQualityArgs,
): Promise<void> {
  const provider = args.provider ?? DEFAULT_PROVIDER;
  const ref = await loadCrmLink(db, args.practiceId, provider);
  if (!ref) {
    throw new Error(`no ${provider} link for practice ${args.practiceId}`);
  }
  await adapter.tagLead(ref, { aeQuality: args.aeQuality });
  await upsertCrmLink(db, {
    practiceId: args.practiceId,
    provider,
    leadQuality: args.aeQuality,
  });
}

export interface RecordStageArgs {
  practiceId: string;
  provider?: string;
}

/**
 * Read the deal's stage + cycle time back from the CRM and persist it for the
 * ROI scoreboard (U12): stage + cycle time on the link row, plus a
 * `meeting_booked`/`deal_won` ROI event.
 */
export async function recordStageForPractice(
  db: Database,
  adapter: CrmAdapter,
  args: RecordStageArgs,
): Promise<StageReadback> {
  const provider = args.provider ?? DEFAULT_PROVIDER;
  const ref = await loadCrmLink(db, args.practiceId, provider);
  if (!ref) {
    throw new Error(`no ${provider} link for practice ${args.practiceId}`);
  }
  // Capture the stored stage BEFORE upsertCrmLink below overwrites it, so we
  // can tell a real stage TRANSITION from a repeated poll of an unchanged stage.
  const priorReadback = await roiCycleTimeReadback(db, args.practiceId, provider);
  const priorStage = priorReadback?.stage ?? null;

  const readback = await adapter.recordStage(ref);

  await upsertCrmLink(db, {
    practiceId: args.practiceId,
    provider,
    stage: readback.stage || null,
    stageChangedAt: readback.closedAt ?? readback.enteredAt ?? null,
    cycleTimeDays: readback.cycleTimeDays,
  });

  // Log a milestone ONLY on an actual stage TRANSITION *to a milestone stage*.
  // Two guards, both load-bearing for R12's numbers:
  //   1. transition, not poll — a repeated poll reading the SAME stage must not
  //      log twice.
  //   2. milestone, not any stage — `stageMilestone` returns null for
  //      mid-pipeline steps and for `closedlost`, so walking the pipeline does
  //      not book four "meetings" and a lost deal is never counted as a win.
  const milestone = stageMilestone(readback.stage);
  if (milestone && readback.stage !== priorStage) {
    await db.insert(roiEvents).values({
      eventType: milestone,
      practiceId: args.practiceId,
      payload: { stage: readback.stage, cycleTimeDays: readback.cycleTimeDays },
    });
  }

  return readback;
}
