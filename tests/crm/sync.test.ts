import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../setup";
import { upsertPractice } from "@/db/ingest";
import {
  getActiveConnection,
  loadConnection,
  roiCycleTimeReadback,
  storeConnection,
  upsertCrmLink,
} from "@/db/crm";
import { crmLinks, roiEvents } from "@/db/schema";
import { encrypt } from "@/src/crm/token-crypto";
import { createHubSpotAdapter } from "@/src/crm/hubspot";
import {
  completeHubSpotConnect,
  createDbTokenProvider,
  pushPracticeLead,
  recordStageForPractice,
  syncLeadQuality,
  syncPracticeLead,
} from "@/src/crm/sync";
import type { OAuthHttpDeps } from "@/src/crm/hubspot-oauth";
import type { LeadInput } from "@/src/crm/adapter";
import {
  hubspotApiMock,
  hubspotConnectMock,
  mockFetch,
  type FetchCall,
} from "./mock-fetch";

const KEY = Buffer.alloc(32, 11);

function oauthDeps(fetchImpl: typeof fetch): OAuthHttpDeps {
  return {
    fetch: fetchImpl,
    clientId: "cid",
    clientSecret: "csecret",
    redirectUri: "https://app.example.com/api/hubspot/oauth",
    baseUrl: "https://api.hubapi.test",
  };
}

const LEAD: LeadInput = {
  companyName: "Georgia Dermatology",
  domain: "gaderm.example.com",
  city: "Atlanta",
  state: "GA",
  contact: { name: "Jane Doe", role: "Practice Manager" },
  tags: { vertical: "dermatology", signalSource: "greenhouse", signalCount: 2, aeQuality: "up" },
};

async function seedPractice(t: TestDb): Promise<string> {
  const p = await upsertPractice(t.db, {
    name: "Georgia Dermatology",
    geoKey: "atlanta-ga",
    vertical: "dermatology",
  });
  return p.id;
}

describe("completeHubSpotConnect (OAuth callback → encrypted, per-tenant storage)", () => {
  let t: TestDb;
  beforeEach(async () => {
    t = await createTestDb();
  });
  afterEach(async () => {
    await t.close();
  });

  it("stores the tokens ENCRYPTED (ciphertext != plaintext) keyed by portal id", async () => {
    const { fetch: f } = hubspotConnectMock();

    const { portalId, scopes } = await completeHubSpotConnect(t.db, oauthDeps(f), {
      code: "the-code",
      encryptionKey: KEY,
      now: () => new Date("2026-07-07T00:00:00Z"),
    });

    expect(portalId).toBe("424242");
    expect(scopes).toContain("crm.objects.deals.write");

    const row = await loadConnection(t.db, "424242");
    expect(row).not.toBeNull();
    // The stored columns must NOT be the plaintext tokens (D9).
    expect(row!.accessTokenEnc).not.toBe("at_live");
    expect(row!.refreshTokenEnc).not.toBe("rt_live");
    // The whole point: the plaintext string does not appear at rest.
    expect(row!.accessTokenEnc).not.toContain("at_live");
    // expiry = now + expires_in
    expect(row!.expiresAt.toISOString()).toBe("2026-07-07T00:30:00.000Z");
  });

  it("provisions the four tag properties on companies AND deals (idempotently)", async () => {
    // Without this, the very first pushLead 400s: PROPERTY_DOESNT_EXIST.
    const mock = hubspotConnectMock();
    await completeHubSpotConnect(t.db, oauthDeps(mock.fetch), {
      code: "the-code",
      encryptionKey: KEY,
    });

    const propertyCalls = mock.calls.filter(
      (c) => c.method === "POST" && c.path.startsWith("/crm/v3/properties/"),
    );
    const created = propertyCalls
      .filter((c) => !c.path.endsWith("/groups"))
      .map((c) => `${c.path}:${(c.body as { name: string }).name}`);

    for (const objectType of ["companies", "deals"]) {
      for (const p of ["vertical", "signal_source", "signal_count", "ae_quality"]) {
        expect(created).toContain(`/crm/v3/properties/${objectType}:${p}`);
      }
      // The group must be created before its properties reference it.
      expect(
        propertyCalls.some((c) => c.path === `/crm/v3/properties/${objectType}/groups`),
      ).toBe(true);
    }
  });

  it("a re-connect to an already-provisioned portal tolerates 409 and still succeeds", async () => {
    // R17: never blindly overwrite a real record — an existing property answers
    // 409 and we move on rather than PATCHing over an admin's customisation.
    const mock = hubspotConnectMock();
    const args = { code: "the-code", encryptionKey: KEY };

    await completeHubSpotConnect(t.db, oauthDeps(mock.fetch), args);
    const second = await completeHubSpotConnect(t.db, oauthDeps(mock.fetch), args);

    expect(second.portalId).toBe("424242");
    // Second pass hit the same routes and got 409s — no throw, one connection row.
    const rows = await getActiveConnection(t.db);
    expect(rows.ok).toBe(true);
  });

  it("reports canSend from the GRANTED scopes, not the requested ones", async () => {
    const free = hubspotConnectMock({ scopes: ["oauth", "crm.objects.deals.write"] });
    const freeResult = await completeHubSpotConnect(t.db, oauthDeps(free.fetch), {
      code: "c1",
      encryptionKey: KEY,
    });
    expect(freeResult.canSend).toBe(false);

    const pro = hubspotConnectMock({
      hubId: 999,
      scopes: ["oauth", "automation.sequences.enrollments.write"],
    });
    const proResult = await completeHubSpotConnect(t.db, oauthDeps(pro.fetch), {
      code: "c2",
      encryptionKey: KEY,
    });
    expect(proResult.canSend).toBe(true);
  });

  it("surfaces a property-provisioning failure rather than reporting a healthy connect", async () => {
    // A portal missing crm.schemas.*.write 403s. Silently swallowing that would
    // hand the AE a CRM connection whose first lead push fails.
    const forbidden = hubspotConnectMock({ propertiesForbidden: true });
    await expect(
      completeHubSpotConnect(t.db, oauthDeps(forbidden.fetch), {
        code: "the-code",
        encryptionKey: KEY,
      }),
    ).rejects.toThrow(/403/);
  });
});

describe("createDbTokenProvider (proactive refresh)", () => {
  let t: TestDb;
  beforeEach(async () => {
    t = await createTestDb();
  });
  afterEach(async () => {
    await t.close();
  });

  it("expired access token → ONE refresh → returns + persists the new token", async () => {
    await storeConnection(t.db, {
      portalId: "P1",
      accessTokenEnc: encrypt("at_old", KEY),
      refreshTokenEnc: encrypt("rt_old", KEY),
      expiresAt: new Date("2026-07-06T00:00:00Z"), // already expired
      scopes: "oauth",
    });

    const { fetch: f, calls } = mockFetch(() => ({
      body: { access_token: "at_refreshed", refresh_token: "rt_new", expires_in: 1800 },
    }));

    const getToken = createDbTokenProvider(t.db, oauthDeps(f), {
      portalId: "P1",
      encryptionKey: KEY,
      now: () => new Date("2026-07-07T00:00:00Z"),
    });

    const token = await getToken();
    expect(token).toBe("at_refreshed");
    // exactly one call to the token endpoint (the refresh)
    expect(calls.filter((c) => c.path === "/oauth/v1/token")).toHaveLength(1);
    expect(new URLSearchParams(String(calls[0].body)).get("grant_type")).toBe(
      "refresh_token",
    );
    // the new token is persisted, still encrypted
    const row = await loadConnection(t.db, "P1");
    expect(row!.accessTokenEnc).not.toContain("at_refreshed");
  });

  it("valid (unexpired) access token → NO refresh call, returns current token", async () => {
    await storeConnection(t.db, {
      portalId: "P2",
      accessTokenEnc: encrypt("at_current", KEY),
      refreshTokenEnc: encrypt("rt", KEY),
      expiresAt: new Date("2026-07-07T02:00:00Z"), // well in the future
    });
    const { fetch: f, calls } = mockFetch(() => ({ body: {} }));
    const getToken = createDbTokenProvider(t.db, oauthDeps(f), {
      portalId: "P2",
      encryptionKey: KEY,
      now: () => new Date("2026-07-07T00:00:00Z"),
    });
    expect(await getToken()).toBe("at_current");
    expect(calls).toHaveLength(0);
  });
});

describe("pushPracticeLead (idempotent push + ROI event)", () => {
  let t: TestDb;
  beforeEach(async () => {
    t = await createTestDb();
  });
  afterEach(async () => {
    await t.close();
  });

  it("first push creates; re-push UPDATES the same link (no duplicate) + logs lead_pushed", async () => {
    const practiceId = await seedPractice(t);
    const mock = hubspotApiMock();
    const adapter = createHubSpotAdapter({
      fetch: mock.fetch,
      getAccessToken: async () => "tok",
      sleep: async () => {},
    });

    const first = await pushPracticeLead(t.db, adapter, { practiceId, lead: LEAD });
    expect(first.created).toBe(true);
    expect(first.companyId).toBe("co_1");

    const second = await pushPracticeLead(t.db, adapter, {
      practiceId,
      lead: { ...LEAD, tags: { ...LEAD.tags, aeQuality: "down" } },
    });
    expect(second.created).toBe(false);
    expect(second.companyId).toBe("co_1"); // same record, updated

    // exactly ONE crm_links row for the practice (idempotency held)
    const links = await t.db
      .select()
      .from(crmLinks)
      .where(eq(crmLinks.practiceId, practiceId));
    expect(links).toHaveLength(1);
    expect(links[0].companyId).toBe("co_1");
    expect(links[0].dealId).toBe("dl_1");

    // only the CREATE logged a lead_pushed ROI event — the idempotent re-push
    // (created:false) must NOT log a second, or the ROI number double-counts.
    const events = await t.db
      .select()
      .from(roiEvents)
      .where(eq(roiEvents.eventType, "lead_pushed"));
    expect(events).toHaveLength(1);
    expect(events[0].vertical).toBe("dermatology");
  });

  it("a hard failure mid-push leaves a partial link that re-sync UPDATES (no duplicate company)", async () => {
    const practiceId = await seedPractice(t);
    let companyPosts = 0;
    let dealPosts = 0;
    const { fetch: f } = mockFetch((call) => {
      const { method, path } = call;
      const id = path.split("/").filter(Boolean).pop() ?? "";
      if (method === "POST" && path.endsWith("/companies")) {
        companyPosts += 1;
        return { body: { id: "co_1" } };
      }
      if (method === "POST" && path.endsWith("/contacts")) return { body: { id: "ct_1" } };
      if (method === "POST" && path.endsWith("/deals")) {
        dealPosts += 1;
        if (dealPosts === 1) return { status: 500, body: { message: "boom" } };
        return { body: { id: "dl_1" } };
      }
      if (method === "PATCH") return { body: { id } };
      return { status: 404, body: {} };
    });
    const adapter = createHubSpotAdapter({
      fetch: f,
      getAccessToken: async () => "tok",
      sleep: async () => {},
    });

    // first sync hard-fails on the deal create
    await expect(
      pushPracticeLead(t.db, adapter, { practiceId, lead: LEAD }),
    ).rejects.toThrow();

    // company + contact ids ARE persisted (partial link), deal is not
    const [partial] = await t.db
      .select()
      .from(crmLinks)
      .where(eq(crmLinks.practiceId, practiceId));
    expect(partial.companyId).toBe("co_1");
    expect(partial.contactId).toBe("ct_1");
    expect(partial.dealId).toBeNull();

    // retry now succeeds — company/contact PATCH, deal created
    const retry = await pushPracticeLead(t.db, adapter, { practiceId, lead: LEAD });
    expect(retry.created).toBe(false);
    expect(retry.dealId).toBe("dl_1");

    // the company was POSTed exactly ONCE across both syncs — no duplicate
    expect(companyPosts).toBe(1);
    const links = await t.db
      .select()
      .from(crmLinks)
      .where(eq(crmLinks.practiceId, practiceId));
    expect(links).toHaveLength(1);
  });
});

describe("recordStageForPractice (stage move → cycle-time in the ROI read-back)", () => {
  let t: TestDb;
  beforeEach(async () => {
    t = await createTestDb();
  });
  afterEach(async () => {
    await t.close();
  });

  it("persists stage + computed cycle time, readable by the ROI query", async () => {
    const practiceId = await seedPractice(t);
    await upsertCrmLink(t.db, {
      practiceId,
      companyId: "co_1",
      contactId: "ct_1",
      dealId: "dl_1",
    });

    const mock = hubspotApiMock({
      deal: {
        dealstage: "closedwon",
        createdate: "2026-07-01T00:00:00Z",
        closedate: "2026-07-06T00:00:00Z",
        hs_v2_date_entered_closedwon: "2026-07-06T00:00:00Z",
      },
    });
    const adapter = createHubSpotAdapter({
      fetch: mock.fetch,
      getAccessToken: async () => "tok",
      sleep: async () => {},
    });

    const readback = await recordStageForPractice(t.db, adapter, { practiceId });
    expect(readback.cycleTimeDays).toBe(5);

    const roi = await roiCycleTimeReadback(t.db, practiceId);
    expect(roi).toEqual({ stage: "closedwon", cycleTimeDays: 5 });

    const won = await t.db
      .select()
      .from(roiEvents)
      .where(eq(roiEvents.eventType, "deal_won"));
    expect(won).toHaveLength(1);
  });

  it("a closed-LOST deal logs NEITHER a win NOR a meeting", async () => {
    const practiceId = await seedPractice(t);
    await upsertCrmLink(t.db, { practiceId, dealId: "dl_2" });
    const mock = hubspotApiMock({
      deal: {
        dealstage: "closedlost",
        createdate: "2026-07-01T00:00:00Z",
        closedate: "2026-07-03T00:00:00Z",
      },
    });
    const adapter = createHubSpotAdapter({
      fetch: mock.fetch,
      getAccessToken: async () => "tok",
      sleep: async () => {},
    });

    await recordStageForPractice(t.db, adapter, { practiceId });

    const won = await t.db
      .select()
      .from(roiEvents)
      .where(eq(roiEvents.eventType, "deal_won"));
    expect(won).toHaveLength(0);
    // A lost deal is not a booked meeting either — `stageMilestone` returns null.
    const meeting = await t.db
      .select()
      .from(roiEvents)
      .where(eq(roiEvents.eventType, "meeting_booked"));
    expect(meeting).toHaveLength(0);
  });

  it("logs meeting_booked when the deal reaches the appointment stage", async () => {
    const practiceId = await seedPractice(t);
    await upsertCrmLink(t.db, { practiceId, dealId: "dl_3" });
    const mock = hubspotApiMock({
      deal: {
        dealstage: "appointmentscheduled",
        createdate: "2026-07-01T00:00:00Z",
      },
    });
    const adapter = createHubSpotAdapter({
      fetch: mock.fetch,
      getAccessToken: async () => "tok",
      sleep: async () => {},
    });

    await recordStageForPractice(t.db, adapter, { practiceId });

    const meeting = await t.db
      .select()
      .from(roiEvents)
      .where(eq(roiEvents.eventType, "meeting_booked"));
    expect(meeting).toHaveLength(1);
  });

  it("pushing a lead then polling its stage logs NO phantom meeting", async () => {
    // The deal is CREATED in HubSpot's first stage (appointmentscheduled), so an
    // unguarded first poll would read that as a transition into the meeting stage
    // and book a meeting for every lead the tool ever pushed.
    const practiceId = await seedPractice(t);
    const mock = hubspotApiMock({
      deal: { dealstage: "appointmentscheduled", createdate: "2026-07-01T00:00:00Z" },
    });
    const adapter = createHubSpotAdapter({
      fetch: mock.fetch,
      getAccessToken: async () => "tok",
      sleep: async () => {},
    });

    await pushPracticeLead(t.db, adapter, { practiceId, lead: LEAD });
    await recordStageForPractice(t.db, adapter, { practiceId });

    const meeting = await t.db
      .select()
      .from(roiEvents)
      .where(eq(roiEvents.eventType, "meeting_booked"));
    expect(meeting).toHaveLength(0);
    // The push itself is still logged, exactly once.
    const pushed = await t.db
      .select()
      .from(roiEvents)
      .where(eq(roiEvents.eventType, "lead_pushed"));
    expect(pushed).toHaveLength(1);
  });

  it("a mid-pipeline stage logs NO milestone (walking the pipeline is not 4 meetings)", async () => {
    const practiceId = await seedPractice(t);
    await upsertCrmLink(t.db, { practiceId, dealId: "dl_4" });
    const mock = hubspotApiMock({
      deal: { dealstage: "presentationscheduled", createdate: "2026-07-01T00:00:00Z" },
    });
    const adapter = createHubSpotAdapter({
      fetch: mock.fetch,
      getAccessToken: async () => "tok",
      sleep: async () => {},
    });

    await recordStageForPractice(t.db, adapter, { practiceId });

    const all = await t.db.select().from(roiEvents);
    expect(all).toHaveLength(0);
  });
});

describe("ROI event double-count guards (review fixes)", () => {
  let t: TestDb;
  beforeEach(async () => {
    t = await createTestDb();
  });
  afterEach(async () => {
    await t.close();
  });

  it("pushPracticeLead twice (second is an idempotent re-push) logs exactly ONE lead_pushed", async () => {
    const practiceId = await seedPractice(t);
    const mock = hubspotApiMock();
    const adapter = createHubSpotAdapter({
      fetch: mock.fetch,
      getAccessToken: async () => "tok",
      sleep: async () => {},
    });

    const first = await pushPracticeLead(t.db, adapter, { practiceId, lead: LEAD });
    expect(first.created).toBe(true);
    const second = await pushPracticeLead(t.db, adapter, { practiceId, lead: LEAD });
    expect(second.created).toBe(false); // idempotent re-push, no new record

    const events = await t.db
      .select()
      .from(roiEvents)
      .where(eq(roiEvents.eventType, "lead_pushed"));
    expect(events).toHaveLength(1);
  });

  it("recordStageForPractice logs a milestone only on a stage TRANSITION, not on a repeated same-stage poll", async () => {
    const practiceId = await seedPractice(t);
    await upsertCrmLink(t.db, { practiceId, dealId: "dl_1" });

    let stage = "appointmentscheduled";
    const { fetch: f } = mockFetch((call) => {
      const { method, path } = call;
      if (method === "GET" && path.includes("/deals/")) {
        return {
          body: {
            id: "dl_1",
            properties: { dealstage: stage, createdate: "2026-07-01T00:00:00Z" },
          },
        };
      }
      return { status: 404, body: {} };
    });
    const adapter = createHubSpotAdapter({
      fetch: f,
      getAccessToken: async () => "tok",
      sleep: async () => {},
    });

    // First poll: stored stage was null → transition → ONE meeting_booked.
    await recordStageForPractice(t.db, adapter, { practiceId });
    // Second poll: SAME stage → no new milestone (would double-count otherwise).
    await recordStageForPractice(t.db, adapter, { practiceId });

    const bookedAfterRepeat = await t.db
      .select()
      .from(roiEvents)
      .where(eq(roiEvents.eventType, "meeting_booked"));
    expect(bookedAfterRepeat).toHaveLength(1);

    // Stage CHANGES → a second (distinct) milestone IS logged.
    stage = "closedwon";
    await recordStageForPractice(t.db, adapter, { practiceId });

    const won = await t.db
      .select()
      .from(roiEvents)
      .where(eq(roiEvents.eventType, "deal_won"));
    expect(won).toHaveLength(1);
    // The earlier same-stage poll never added a second meeting_booked.
    const bookedFinal = await t.db
      .select()
      .from(roiEvents)
      .where(eq(roiEvents.eventType, "meeting_booked"));
    expect(bookedFinal).toHaveLength(1);
  });
});

describe("syncLeadQuality (AE 👍/👎 → CRM + link)", () => {
  let t: TestDb;
  beforeEach(async () => {
    t = await createTestDb();
  });
  afterEach(async () => {
    await t.close();
  });

  it("PATCHes ae_quality on the CRM records and updates the link's lead_quality", async () => {
    const practiceId = await seedPractice(t);
    await upsertCrmLink(t.db, {
      practiceId,
      companyId: "co_1",
      contactId: "ct_1",
      dealId: "dl_1",
      leadQuality: "up",
    });
    const mock = hubspotApiMock();
    const adapter = createHubSpotAdapter({
      fetch: mock.fetch,
      getAccessToken: async () => "tok",
      sleep: async () => {},
    });

    await syncLeadQuality(t.db, adapter, { practiceId, aeQuality: "down" });

    const patched = mock.calls.map((c: FetchCall) => `${c.method} ${c.path}`);
    expect(patched).toContain("PATCH /crm/v3/objects/companies/co_1");
    expect(patched).toContain("PATCH /crm/v3/objects/deals/dl_1");

    const [link] = await t.db
      .select({ leadQuality: crmLinks.leadQuality })
      .from(crmLinks)
      .where(eq(crmLinks.practiceId, practiceId));
    expect(link.leadQuality).toBe("down");
  });
});

describe("getActiveConnection (server-side tenant resolution)", () => {
  let t: TestDb;
  beforeEach(async () => {
    t = await createTestDb();
  });
  afterEach(async () => {
    await t.close();
  });

  async function seedConn(portalId: string): Promise<void> {
    await storeConnection(t.db, {
      portalId,
      accessTokenEnc: encrypt("at", KEY),
      refreshTokenEnc: encrypt("rt", KEY),
      expiresAt: new Date("2026-07-07T02:00:00Z"),
    });
  }

  it("returns 'none' when no connection exists", async () => {
    expect(await getActiveConnection(t.db)).toEqual({ ok: false, reason: "none" });
  });

  it("returns the single connection when exactly one exists", async () => {
    await seedConn("REAL");
    const res = await getActiveConnection(t.db);
    expect(res.ok).toBe(true);
    expect(res.ok && res.connection.portalId).toBe("REAL");
  });

  it("refuses to guess when more than one connection exists (ambiguous)", async () => {
    await seedConn("P_A");
    await seedConn("P_B");
    expect(await getActiveConnection(t.db)).toEqual({ ok: false, reason: "ambiguous" });
  });
});

describe("syncPracticeLead (IDOR-safe push: portal resolved server-side)", () => {
  let t: TestDb;
  beforeEach(async () => {
    t = await createTestDb();
  });
  afterEach(async () => {
    await t.close();
  });

  it("uses the SERVER-RESOLVED connection's token — a body cannot redirect the portal", async () => {
    const practiceId = await seedPractice(t);
    // one stored connection; its access token is "at_real". Far-future expiry
    // (syncPracticeLead uses the real clock) → no refresh, the stored token is used.
    await storeConnection(t.db, {
      portalId: "REAL_PORTAL",
      accessTokenEnc: encrypt("at_real", KEY),
      refreshTokenEnc: encrypt("rt_real", KEY),
      expiresAt: new Date("2099-01-01T00:00:00Z"),
    });

    const mock = hubspotApiMock();
    // Note: syncPracticeLead takes NO portalId param — there is no input by
    // which a caller could point this at a different connection (IDOR closed).
    const outcome = await syncPracticeLead(t.db, oauthDeps(mock.fetch), {
      practiceId,
      lead: LEAD,
      encryptionKey: KEY,
    });

    expect(outcome.ok).toBe(true);
    expect(outcome.ok && outcome.result.companyId).toBe("co_1");
    // every HubSpot call carried the token decrypted from the RESOLVED connection
    const authed = mock.calls.filter((c) => c.path.startsWith("/crm/"));
    expect(authed.length).toBeGreaterThan(0);
    expect(authed.every((c) => c.authorization === "Bearer at_real")).toBe(true);
    // the lead landed
    const [link] = await t.db
      .select()
      .from(crmLinks)
      .where(eq(crmLinks.practiceId, practiceId));
    expect(link.companyId).toBe("co_1");
  });

  it("returns 409 when there is no connection to push through", async () => {
    const practiceId = await seedPractice(t);
    const mock = hubspotApiMock();
    const outcome = await syncPracticeLead(t.db, oauthDeps(mock.fetch), {
      practiceId,
      lead: LEAD,
      encryptionKey: KEY,
    });
    expect(outcome).toEqual({
      ok: false,
      status: 409,
      error: "No HubSpot connection — connect HubSpot first",
    });
    expect(mock.calls).toHaveLength(0); // nothing pushed
  });

  it("returns 503 when connections are ambiguous rather than guessing a tenant", async () => {
    const practiceId = await seedPractice(t);
    for (const portalId of ["P_A", "P_B"]) {
      await storeConnection(t.db, {
        portalId,
        accessTokenEnc: encrypt("at", KEY),
        refreshTokenEnc: encrypt("rt", KEY),
        expiresAt: new Date("2026-07-07T02:00:00Z"),
      });
    }
    const mock = hubspotApiMock();
    const outcome = await syncPracticeLead(t.db, oauthDeps(mock.fetch), {
      practiceId,
      lead: LEAD,
      encryptionKey: KEY,
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false && outcome.status).toBe(503);
    expect(mock.calls).toHaveLength(0);
  });
});
