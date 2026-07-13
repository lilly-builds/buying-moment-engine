import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../setup";
import { upsertPractice } from "@/db/ingest";
import {
  getActiveConnection,
  loadConnection,
  roiCycleTimeReadback,
  setConnectionSendConfig,
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
  sendReadiness,
  syncLeadQuality,
  syncPracticeLead,
} from "@/src/crm/sync";
import type { OAuthHttpDeps } from "@/src/crm/hubspot-oauth";
import { SEND_PROPERTY_NAMES } from "@/src/send/hubspot-send";
import type { CrmAdapter, LeadInput } from "@/src/crm/adapter";
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
    // The sending inbox + user auto-captured from the token meta (only the sequence
    // id still needs a manual paste — HubSpot has no list-sequence API).
    expect(row!.senderEmail).toBe("rep@portal.test");
    expect(row!.senderUserId).toBe("95142122");
    // sequence_id is NOT set at connect — it's pasted later on the Connections page.
    expect(row!.sequenceId).toBeNull();
  });

  it("preserves a manually-set sequence id across a reconnect (no wipe)", async () => {
    const mock = hubspotConnectMock();
    const args = { code: "c", encryptionKey: KEY } as const;
    await completeHubSpotConnect(t.db, oauthDeps(mock.fetch), args);
    // The user finishes sequence setup and pastes the id (the capture endpoint).
    await setConnectionSendConfig(t.db, { portalId: "424242", sequenceId: "712515259" });
    // A later reconnect (e.g. to grant an added scope) must NOT null the sequence.
    await completeHubSpotConnect(t.db, oauthDeps(mock.fetch), args);

    const row = await loadConnection(t.db, "424242");
    expect(row!.sequenceId).toBe("712515259");
    expect(row!.senderEmail).toBe("rep@portal.test"); // sender still refreshes
  });

  it("does NOT wipe a captured sender when a reconnect's token payload omits user", async () => {
    // First connect captures the sender from a normal payload.
    await completeHubSpotConnect(t.db, oauthDeps(hubspotConnectMock().fetch), {
      code: "c",
      encryptionKey: KEY,
    });
    // A later reconnect whose token-info omits user/user_id must LEAVE the captured
    // sender intact (undefined = don't touch), not null it — else the Send button
    // would go dark with no UI to restore it.
    await completeHubSpotConnect(t.db, oauthDeps(hubspotConnectMock({ omitUser: true }).fetch), {
      code: "c",
      encryptionKey: KEY,
    });

    const row = await loadConnection(t.db, "424242");
    expect(row!.senderEmail).toBe("rep@portal.test");
    expect(row!.senderUserId).toBe("95142122");
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

  it("provisions the per-touch SEND properties on the contact object (one Connect readies send)", async () => {
    // Without this, the first sendSequence 400s on the _2 / _3 tokens that don't
    // exist yet. Connect must ready CRM push AND send in one grant.
    const mock = hubspotConnectMock();
    await completeHubSpotConnect(t.db, oauthDeps(mock.fetch), {
      code: "the-code",
      encryptionKey: KEY,
    });

    const created = mock.calls
      .filter((c) => c.method === "POST" && c.path === "/crm/v3/properties/contacts")
      .map((c) => String((c.body as { name: unknown }).name));

    // All six send properties (subject + body × 3 touches) provisioned on contacts.
    expect(SEND_PROPERTY_NAMES).toHaveLength(6);
    for (const name of SEND_PROPERTY_NAMES) expect(created).toContain(name);
    // Their group is created before the properties reference it.
    expect(
      mock.calls.some(
        (c) => c.method === "POST" && c.path === "/crm/v3/properties/contacts/groups",
      ),
    ).toBe(true);
  });

  it("a send-property provisioning failure leaves NO connection (same invariant as tags)", async () => {
    // Every /crm/v3/properties/* call 403s — a portal missing crm.schemas.contacts.write
    // must fail the connect loudly, not leave a usable-looking-but-broken connection.
    const forbidden = hubspotConnectMock({ propertiesForbidden: true });
    await expect(
      completeHubSpotConnect(t.db, oauthDeps(forbidden.fetch), {
        code: "the-code",
        encryptionKey: KEY,
      }),
    ).rejects.toThrow(/403/);
    expect((await getActiveConnection(t.db)).ok).toBe(false);
  });

  it("a re-connect reconciles the six send-property labels (fixes a stale portal)", async () => {
    // R17 still holds for the TAG properties (tolerate 409 — don't clobber an
    // admin's customisation). But the six SEND-property labels are the tokens the
    // Sequence picks by, so a stale label (from an older build) is corrected on
    // every reconnect: the app owns getting the field name right, not the agent.
    const mock = hubspotConnectMock();
    const args = { code: "the-code", encryptionKey: KEY };

    await completeHubSpotConnect(t.db, oauthDeps(mock.fetch), args);
    const second = await completeHubSpotConnect(t.db, oauthDeps(mock.fetch), args);

    expect(second.portalId).toBe("424242");
    // Second pass hit the same routes, got 409s, and relabeled — no throw, one row.
    const rows = await getActiveConnection(t.db);
    expect(rows.ok).toBe(true);
    // Reconnect PATCHed the label of each already-existing send property back to
    // canonical (six contact-property label reconciles).
    const relabels = mock.calls.filter(
      (c) =>
        c.method === "PATCH" &&
        /^\/crm\/v3\/properties\/contacts\/gtm_maestro_custom_/.test(c.path),
    );
    expect(relabels).toHaveLength(6);
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

  it("a FAILED connect persists NO connection — no usable-looking state left behind", async () => {
    // Storing the tokens before provisioning meant the user was told "connect
    // failed" while getActiveConnection still resolved and sendReadiness reported
    // connected:true — every later push then died with an opaque 502.
    const forbidden = hubspotConnectMock({ propertiesForbidden: true });
    await expect(
      completeHubSpotConnect(t.db, oauthDeps(forbidden.fetch), {
        code: "the-code",
        encryptionKey: KEY,
      }),
    ).rejects.toThrow();

    const active = await getActiveConnection(t.db);
    expect(active.ok).toBe(false);
    expect(await sendReadiness(t.db)).toEqual({ connected: false, canSend: false });
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

    // …and the lead IS counted, exactly once. Keying `lead_pushed` off "was the
    // company created" lost it entirely here: the retry saw an existing companyId,
    // reported created:false, and never logged the push that actually landed.
    const pushed = await t.db
      .select()
      .from(roiEvents)
      .where(eq(roiEvents.eventType, "lead_pushed"));
    expect(pushed).toHaveLength(1);
  });

  it("a crash AFTER the deal lands does not lose lead_pushed, forever", async () => {
    // `onProgress` commits the deal id in a statement of its OWN, before the final
    // `upsertCrmLink` + `roi_events` insert. Kill the request in that window and a
    // guard keyed on "has the deal already landed?" reads a landed deal on every
    // later retry and skips the event permanently — a silent, unrecoverable
    // under-count. The exactly-once invariant has to re-read `roi_events` (the
    // ground truth), not a cache of it. Same lesson as `deal_won`.
    //
    // NOTE: a transaction around the final upsert + insert does NOT fix this — the
    // deal id was committed by `onProgress`, outside any such transaction.
    const practiceId = await seedPractice(t);
    const mock = hubspotApiMock();
    const adapter = createHubSpotAdapter({
      fetch: mock.fetch,
      getAccessToken: async () => "tok",
      sleep: async () => {},
    });

    // Walk the REAL push — the deal lands and its id is committed — then die exactly
    // where a serverless timeout, a pod kill, or a DB blip would.
    const crashing: CrmAdapter = {
      ...adapter,
      pushLead: async (lead, existing, onProgress) => {
        await adapter.pushLead(lead, existing, onProgress);
        throw new Error("process died after the deal landed");
      },
    };
    await expect(
      pushPracticeLead(t.db, crashing, { practiceId, lead: LEAD }),
    ).rejects.toThrow(/died after the deal landed/);

    // The trap: the deal DID land, and its id is durably persisted…
    const [partial] = await t.db
      .select()
      .from(crmLinks)
      .where(eq(crmLinks.practiceId, practiceId));
    expect(partial.dealId).not.toBeNull();
    // …while the ROI event that records it never got written.
    const beforeRetry = await t.db
      .select()
      .from(roiEvents)
      .where(eq(roiEvents.eventType, "lead_pushed"));
    expect(beforeRetry).toHaveLength(0);

    // The retry re-pushes idempotently — the deal is PATCHed, never re-created…
    await pushPracticeLead(t.db, adapter, { practiceId, lead: LEAD });
    const dealPosts = mock.calls.filter(
      (c) => c.method === "POST" && c.path.endsWith("/deals"),
    );
    expect(dealPosts).toHaveLength(1);

    // …and the lead that actually landed IS counted, exactly once.
    const pushed = await t.db
      .select()
      .from(roiEvents)
      .where(eq(roiEvents.eventType, "lead_pushed"));
    expect(pushed).toHaveLength(1);
  });

  it("re-pushing an already-landed lead logs no second lead_pushed", async () => {
    const practiceId = await seedPractice(t);
    const mock = hubspotApiMock();
    const adapter = createHubSpotAdapter({
      fetch: mock.fetch,
      getAccessToken: async () => "tok",
      sleep: async () => {},
    });

    await pushPracticeLead(t.db, adapter, { practiceId, lead: LEAD });
    await pushPracticeLead(t.db, adapter, { practiceId, lead: LEAD });

    const pushed = await t.db
      .select()
      .from(roiEvents)
      .where(eq(roiEvents.eventType, "lead_pushed"));
    expect(pushed).toHaveLength(1);
  });

  it("a re-push does NOT clobber the stored stage the AE has moved the deal to", async () => {
    const practiceId = await seedPractice(t);
    const mock = hubspotApiMock();
    const adapter = createHubSpotAdapter({
      fetch: mock.fetch,
      getAccessToken: async () => "tok",
      sleep: async () => {},
    });

    await pushPracticeLead(t.db, adapter, { practiceId, lead: LEAD });
    // The AE advanced the deal; a later poll persisted that.
    await upsertCrmLink(t.db, { practiceId, stage: "closedwon", cycleTimeDays: 5 });

    await pushPracticeLead(t.db, adapter, { practiceId, lead: LEAD });

    const [link] = await t.db
      .select()
      .from(crmLinks)
      .where(eq(crmLinks.practiceId, practiceId));
    expect(link.stage).toBe("closedwon");
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

  it("the appointment stage NEVER books a meeting — it is the stage we create deals in", async () => {
    // Honest consequence, documented in stages.ts: on HubSpot's DEFAULT pipeline
    // the first stage is "Appointment Scheduled", which is where the tool puts
    // every deal it creates. So meeting_booked reads zero. Giving that tile a real
    // number needs a pipeline whose first stage means "surfaced, not yet worked"
    // (U12) — at which point this guard releases itself. We do not fake it.
    const practiceId = await seedPractice(t);
    await upsertCrmLink(t.db, { practiceId, dealId: "dl_3" });

    await pollAt(t, practiceId, "appointmentscheduled");

    const meeting = await t.db
      .select()
      .from(roiEvents)
      .where(eq(roiEvents.eventType, "meeting_booked"));
    expect(meeting).toHaveLength(0);
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

  /** Poll the practice's stage once, with the deal reading back at `dealstage`. */
  async function pollAt(t: TestDb, practiceId: string, dealstage: string) {
    const mock = hubspotApiMock({
      deal: { dealstage, createdate: "2026-07-01T00:00:00Z" },
    });
    const adapter = createHubSpotAdapter({
      fetch: mock.fetch,
      getAccessToken: async () => "tok",
      sleep: async () => {},
    });
    return recordStageForPractice(t.db, adapter, { practiceId });
  }

  it("PUSHED lead, advanced, then moved BACK to the create stage books NO meeting", async () => {
    // The path production actually takes. `pushPracticeLead` seeds the created
    // stage, so poll #1 is silent — which means a "differs from last poll" guard
    // never primes, and the backwards move looks like a fresh transition into the
    // meeting stage. No meeting was ever booked: the deal simply returned to the
    // stage the tool created it in.
    const practiceId = await seedPractice(t);
    const mock = hubspotApiMock();
    const adapter = createHubSpotAdapter({
      fetch: mock.fetch,
      getAccessToken: async () => "tok",
      sleep: async () => {},
    });
    await pushPracticeLead(t.db, adapter, { practiceId, lead: LEAD });

    await pollAt(t, practiceId, "appointmentscheduled"); // first poll
    await pollAt(t, practiceId, "qualifiedtobuy"); // AE advances it
    await pollAt(t, practiceId, "appointmentscheduled"); // AE moves it back

    const meeting = await t.db
      .select()
      .from(roiEvents)
      .where(eq(roiEvents.eventType, "meeting_booked"));
    expect(meeting).toHaveLength(0);
  });

  it("a crash between the stage write and the event insert does not lose deal_won", async () => {
    // `upsertCrmLink` commits the stage before the roi_events insert, and they are
    // not one statement. A guard keyed on "stage differs from last poll" would see
    // an unchanged stage on every later poll and lose the win permanently. The
    // exactly-once invariant must re-read roi_events, not a cache of it.
    const practiceId = await seedPractice(t);
    await upsertCrmLink(t.db, { practiceId, dealId: "dl_crash" });
    // Simulate the interrupted poll: stage persisted, event never written.
    await upsertCrmLink(t.db, { practiceId, stage: "closedwon" });

    await pollAt(t, practiceId, "closedwon");

    const won = await t.db
      .select()
      .from(roiEvents)
      .where(eq(roiEvents.eventType, "deal_won"));
    expect(won).toHaveLength(1);
  });

  it("a won deal reopened and re-won does not log a second deal_won", async () => {
    const practiceId = await seedPractice(t);
    await upsertCrmLink(t.db, { practiceId, dealId: "dl_reopen" });

    const stages = ["closedwon", "contractsent", "closedwon"];
    for (const dealstage of stages) {
      const mock = hubspotApiMock({
        deal: {
          dealstage,
          createdate: "2026-07-01T00:00:00Z",
          hs_v2_date_entered_closedwon: "2026-07-06T00:00:00Z",
        },
      });
      const adapter = createHubSpotAdapter({
        fetch: mock.fetch,
        getAccessToken: async () => "tok",
        sleep: async () => {},
      });
      await recordStageForPractice(t.db, adapter, { practiceId });
    }

    const won = await t.db
      .select()
      .from(roiEvents)
      .where(eq(roiEvents.eventType, "deal_won"));
    expect(won).toHaveLength(1);
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

  it("recordStageForPractice logs each milestone at most once, however often it is polled", async () => {
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

    // The appointment stage is the stage the tool CREATES deals in, so it is never
    // a milestone — polling it logs nothing, however many times.
    await recordStageForPractice(t.db, adapter, { practiceId });
    await recordStageForPractice(t.db, adapter, { practiceId });

    const bookedAfterRepeat = await t.db
      .select()
      .from(roiEvents)
      .where(eq(roiEvents.eventType, "meeting_booked"));
    expect(bookedAfterRepeat).toHaveLength(0);

    // A real milestone stage IS logged — once, no matter how often it is polled.
    stage = "closedwon";
    await recordStageForPractice(t.db, adapter, { practiceId });
    await recordStageForPractice(t.db, adapter, { practiceId });

    const won = await t.db
      .select()
      .from(roiEvents)
      .where(eq(roiEvents.eventType, "deal_won"));
    expect(won).toHaveLength(1);
    // The appointment-stage polls never added a meeting_booked.
    const bookedFinal = await t.db
      .select()
      .from(roiEvents)
      .where(eq(roiEvents.eventType, "meeting_booked"));
    expect(bookedFinal).toHaveLength(0);
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
