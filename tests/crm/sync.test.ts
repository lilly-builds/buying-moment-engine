import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../setup";
import { upsertPractice } from "@/db/ingest";
import {
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
} from "@/src/crm/sync";
import type { OAuthHttpDeps } from "@/src/crm/hubspot-oauth";
import type { LeadInput } from "@/src/crm/adapter";
import { hubspotApiMock, mockFetch, type FetchCall } from "./mock-fetch";

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
    const { fetch: f } = mockFetch((call) => {
      if (call.path === "/oauth/v1/token") {
        return { body: { access_token: "at_live", refresh_token: "rt_live", expires_in: 1800 } };
      }
      if (call.path.startsWith("/oauth/v1/access-tokens/")) {
        return { body: { hub_id: 424242, scopes: ["oauth", "crm.objects.deals.write"] } };
      }
      return { status: 404, body: {} };
    });

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

    // both pushes logged a lead_pushed ROI event
    const events = await t.db
      .select()
      .from(roiEvents)
      .where(eq(roiEvents.eventType, "lead_pushed"));
    expect(events).toHaveLength(2);
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

  it("a closed-LOST deal is NOT logged as a win", async () => {
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
    const meeting = await t.db
      .select()
      .from(roiEvents)
      .where(eq(roiEvents.eventType, "meeting_booked"));
    expect(meeting).toHaveLength(1);
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
