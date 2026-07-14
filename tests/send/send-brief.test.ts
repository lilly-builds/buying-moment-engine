import { beforeEach, describe, expect, it } from "vitest";
import { contacts } from "@/db/schema";
import { upsertPractice } from "@/db/ingest";
import { setConnectionSendConfig, storeConnection } from "@/db/crm";
import { encrypt } from "@/src/crm/token-crypto";
import { HUBSPOT_SEND_SCOPE } from "@/src/crm/hubspot-oauth";
import type { OAuthHttpDeps } from "@/src/crm/hubspot-oauth";
import { sendBriefEmail } from "@/src/send/send-brief";
import { claimSend, getSendState } from "@/db/outreach";
import type { SandboxConfig } from "@/src/send/guard";
import {
  CUSTOM_BODY_PROPERTY,
  CUSTOM_SUBJECT_PROPERTY,
  touchPropertyPair,
} from "@/src/send/hubspot-send";
import { createTestDb, type TestDb } from "../setup";
import { mockFetch, type MockFetch } from "../crm/mock-fetch";

/**
 * Send orchestrator (U11) — the flow behind the dashboard's "Send" button, against
 * PGlite + a mocked HubSpot. Proves the D9 firewall fires BEFORE any network I/O,
 * and that a sandbox lead pushes its contact and enrolls with the AE's edited copy.
 */

const KEY = Buffer.alloc(32, 7);
const PORTAL = "portal_send_1";
const BASE = "https://api.hubapi.test";

const SANDBOX_EMAIL = "hellolillyfield@gmail.com";
// The D9 firewall (env). The sequence + sender now live on the CONNECTION (below).
const SANDBOX: SandboxConfig = { allowedEmails: [SANDBOX_EMAIL] };
// The per-connection send identity the seeded connection carries.
const SEQUENCE_ID = "712515259";
const SENDER_USER_ID = "95142122";
// The AE whose session drives the send — stamped on the shared outreach_sends claim.
const SENT_BY = "ae@opterra.test";

function oauthDeps(fetchImpl: typeof fetch): OAuthHttpDeps {
  return {
    fetch: fetchImpl,
    clientId: "cid",
    clientSecret: "csecret-never-leak",
    redirectUri: "https://app.example.com/cb",
    baseUrl: BASE,
  };
}

/** Full HubSpot send surface: CRM push (company/contact/deal) + property write + enroll. */
function sendMock(): MockFetch {
  let co = 0;
  let ct = 0;
  let dl = 0;
  return mockFetch((call) => {
    const { method, path } = call;
    if (method === "POST" && path === "/oauth/v1/token") {
      return { body: { access_token: "at_fresh", refresh_token: "rt_2", expires_in: 1800 } };
    }
    if (method === "POST" && path.endsWith("/objects/companies")) {
      return { body: { id: `co_${++co}` } };
    }
    if (method === "POST" && path === "/crm/v3/objects/contacts/batch/upsert") {
      return { body: { results: [{ id: `ct_${++ct}`, new: true }] } };
    }
    if (method === "PUT" && /\/crm\/v4\/objects\/.+\/associations\/default\//.test(path)) {
      return { status: 200, body: {} };
    }
    if (method === "POST" && path.endsWith("/objects/deals")) {
      return { body: { id: `dl_${++dl}` } };
    }
    if (method === "PATCH" && path.startsWith("/crm/v3/objects/contacts/")) {
      return { body: { id: path.split("/").pop() } };
    }
    if (method === "POST" && path.endsWith("/enrollments")) {
      return { status: 201, body: { enrollmentId: "enr_1" } };
    }
    return { status: 404, body: { path } };
  });
}

/** A send mock whose CRM push succeeds but whose enrollment step returns `body` as a 400. */
function enrollFailsMock(body: unknown): MockFetch {
  return mockFetch((call) => {
    const { method, path } = call;
    if (method === "POST" && path === "/oauth/v1/token") {
      return { body: { access_token: "at_fresh", refresh_token: "rt_2", expires_in: 1800 } };
    }
    if (method === "POST" && path.endsWith("/objects/companies")) return { body: { id: "co_1" } };
    if (method === "POST" && path === "/crm/v3/objects/contacts/batch/upsert") {
      return { body: { results: [{ id: "ct_1", new: true }] } };
    }
    if (method === "PUT" && /\/crm\/v4\/objects\/.+\/associations\/default\//.test(path)) {
      return { status: 200, body: {} };
    }
    if (method === "POST" && path.endsWith("/objects/deals")) return { body: { id: "dl_1" } };
    if (method === "PATCH" && path.startsWith("/crm/v3/objects/contacts/")) {
      return { body: { id: "ct_1" } };
    }
    if (method === "POST" && path.endsWith("/enrollments")) return { status: 400, body };
    return { status: 404, body: { path } };
  });
}

async function seedPractice(
  tdb: TestDb,
  opts: { geoKey: string; email: string | null },
): Promise<string> {
  const practice = await upsertPractice(tdb.db, {
    name: "Test Practice",
    geoKey: opts.geoKey,
    city: "Austin",
    state: "TX",
    vertical: "dermatology",
  });
  await tdb.db.insert(contacts).values({
    practiceId: practice.id,
    name: "Lilly Field",
    role: "Practice Manager",
    email: opts.email,
  });
  return practice.id;
}

async function seedConnection(
  tdb: TestDb,
  scopes: string,
  // The connection carries the send identity; omit sequenceId to simulate a portal
  // that connected but hasn't finished sequence setup yet.
  sendConfig: { sequenceId?: string | null; senderEmail?: string | null; senderUserId?: string | null } = {
    sequenceId: SEQUENCE_ID,
    senderEmail: SANDBOX_EMAIL,
    senderUserId: SENDER_USER_ID,
  },
): Promise<void> {
  await storeConnection(tdb.db, {
    provider: "hubspot",
    portalId: PORTAL,
    accessTokenEnc: encrypt("at_current", KEY),
    refreshTokenEnc: encrypt("rt_1", KEY),
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    scopes,
    senderEmail: sendConfig.senderEmail ?? null,
    senderUserId: sendConfig.senderUserId ?? null,
  });
  // sequence_id is set out-of-band (the capture endpoint), never at connect.
  if (sendConfig.sequenceId) {
    await setConnectionSendConfig(tdb.db, {
      portalId: PORTAL,
      sequenceId: sendConfig.sequenceId,
    });
  }
}

const GRANTED = `crm.objects.companies.write crm.objects.contacts.write crm.objects.deals.write ${HUBSPOT_SEND_SCOPE}`;

describe("sendBriefEmail (U11 send orchestrator)", () => {
  let tdb: TestDb;
  beforeEach(async () => {
    tdb = await createTestDb();
  });

  it("launches a 3-touch sequence — all 6 property values in ONE PATCH, ONE enroll", async () => {
    const practiceId = await seedPractice(tdb, { geoKey: "demo:sandbox-lilly", email: SANDBOX_EMAIL });
    await seedConnection(tdb, GRANTED);
    const { fetch: f, calls } = sendMock();

    const touches = [
      { touchNumber: 1, subject: "3 new front-desk reqs", body: "Hi Lilly — worth 15 minutes?" },
      { touchNumber: 2, subject: "One more thought", body: "The proof point I mentioned." },
      { touchNumber: 3, subject: "Closing the loop", body: "No worries if now's not the time." },
    ];
    const out = await sendBriefEmail(tdb.db, oauthDeps(f), {
      practiceId,
      touches,
      encryptionKey: KEY,
      sandbox: SANDBOX,
      sentBy: SENT_BY,
    });

    expect(out).toMatchObject({ ok: true, enrolled: true, touchNumber: 1, touchesSent: 3 });

    // Exactly ONE PATCH — all touches ship together (a contact enrolls once).
    const patches = calls.filter(
      (c) => c.method === "PATCH" && c.path.startsWith("/crm/v3/objects/contacts/"),
    );
    expect(patches).toHaveLength(1);
    const props = (patches[0].body as { properties?: Record<string, string> }).properties ?? {};
    // Each touch's EXACT copy landed in ITS property pair (touch 1 unsuffixed).
    for (const t of touches) {
      const pair = touchPropertyPair(t.touchNumber);
      expect(props[pair.subject]).toBe(t.subject);
      expect(props[pair.body]).toBe(t.body);
    }
    expect(props[CUSTOM_SUBJECT_PROPERTY]).toBe(touches[0].subject);
    expect(props[CUSTOM_BODY_PROPERTY]).toBe(touches[0].body);

    // Exactly ONE enrollment, with the configured sequence + sender.
    const enrolls = calls.filter((c) => c.path.endsWith("/enrollments"));
    expect(enrolls).toHaveLength(1);
    expect(enrolls[0].query.get("userId")).toBe("95142122");
    expect(enrolls[0].body).toMatchObject({ sequenceId: "712515259", senderEmail: SANDBOX_EMAIL });
  });

  it("a single-touch launch still works (back-compat) — one pair, one enroll", async () => {
    const practiceId = await seedPractice(tdb, { geoKey: "demo:sandbox-lilly", email: SANDBOX_EMAIL });
    await seedConnection(tdb, GRANTED);
    const { fetch: f, calls } = sendMock();

    const out = await sendBriefEmail(tdb.db, oauthDeps(f), {
      practiceId,
      touches: [{ touchNumber: 1, subject: "Just touch 1", body: "Hi Lilly." }],
      encryptionKey: KEY,
      sandbox: SANDBOX,
      sentBy: SENT_BY,
    });

    expect(out).toMatchObject({ ok: true, enrolled: true, touchesSent: 1 });
    const patch = calls.find((c) => c.method === "PATCH" && c.path.startsWith("/crm/v3/objects/contacts/"));
    const props = (patch?.body as { properties?: Record<string, string> })?.properties ?? {};
    expect(props[CUSTOM_SUBJECT_PROPERTY]).toBe("Just touch 1");
    expect(props[CUSTOM_BODY_PROPERTY]).toBe("Hi Lilly.");
    // Only touch 1's pair is written — nothing for _2 / _3.
    expect(props[touchPropertyPair(2).subject]).toBeUndefined();
    expect(props[touchPropertyPair(3).body]).toBeUndefined();
    expect(calls.filter((c) => c.path.endsWith("/enrollments"))).toHaveLength(1);
  });

  it("BLOCKS a real practice before ANY network I/O (D9)", async () => {
    // A real discovered practice (no demo: prefix) classifies real_practice, even
    // though its address happens to be the registered sandbox one.
    const practiceId = await seedPractice(tdb, { geoKey: "austin-tx", email: SANDBOX_EMAIL });
    await seedConnection(tdb, GRANTED);
    const { fetch: f, calls } = sendMock();

    const out = await sendBriefEmail(tdb.db, oauthDeps(f), {
      practiceId,
      touches: [{ touchNumber: 1, subject: "s", body: "b" }],
      encryptionKey: KEY,
      sandbox: SANDBOX,
      sentBy: SENT_BY,
    });

    expect(out).toMatchObject({ ok: false, status: 403 });
    expect(calls).toHaveLength(0); // fail-closed: nothing left the process
  });

  it("BLOCKS a sandbox practice whose address is NOT registered (D9 address arm)", async () => {
    const practiceId = await seedPractice(tdb, { geoKey: "demo:x", email: "someone@real-derm.com" });
    await seedConnection(tdb, GRANTED);
    const { fetch: f, calls } = sendMock();

    const out = await sendBriefEmail(tdb.db, oauthDeps(f), {
      practiceId,
      touches: [{ touchNumber: 1, subject: "s", body: "b" }],
      encryptionKey: KEY,
      sandbox: SANDBOX,
      sentBy: SENT_BY,
    });

    expect(out).toMatchObject({ ok: false, status: 403 });
    expect(calls).toHaveLength(0);
  });

  it("422s when the practice has no contact address", async () => {
    const practiceId = await seedPractice(tdb, { geoKey: "demo:sandbox-lilly", email: null });
    await seedConnection(tdb, GRANTED);
    const { fetch: f } = sendMock();

    const out = await sendBriefEmail(tdb.db, oauthDeps(f), {
      practiceId,
      touches: [{ touchNumber: 1, subject: "s", body: "b" }],
      encryptionKey: KEY,
      sandbox: SANDBOX,
      sentBy: SENT_BY,
    });
    expect(out).toMatchObject({ ok: false, status: 422 });
  });

  it("409s when no HubSpot connection is stored", async () => {
    const practiceId = await seedPractice(tdb, { geoKey: "demo:sandbox-lilly", email: SANDBOX_EMAIL });
    const { fetch: f } = sendMock();

    const out = await sendBriefEmail(tdb.db, oauthDeps(f), {
      practiceId,
      touches: [{ touchNumber: 1, subject: "s", body: "b" }],
      encryptionKey: KEY,
      sandbox: SANDBOX,
      sentBy: SENT_BY,
    });
    // A 409, but NOT a claim-conflict — the UI must treat it as retryable, not "Sent".
    expect(out).toMatchObject({ ok: false, status: 409 });
    if (!out.ok) expect(out.alreadySent).toBeFalsy();
  });

  it("403s when the connection lacks the Sequences send scope", async () => {
    const practiceId = await seedPractice(tdb, { geoKey: "demo:sandbox-lilly", email: SANDBOX_EMAIL });
    await seedConnection(tdb, "crm.objects.contacts.write"); // no send scope granted
    const { fetch: f, calls } = sendMock();

    const out = await sendBriefEmail(tdb.db, oauthDeps(f), {
      practiceId,
      touches: [{ touchNumber: 1, subject: "s", body: "b" }],
      encryptionKey: KEY,
      sandbox: SANDBOX,
      sentBy: SENT_BY,
    });
    expect(out).toMatchObject({ ok: false, status: 403 });
    expect(calls).toHaveLength(0); // scope check is before any HubSpot call
  });

  it("503s when the connection has no sequence_id yet (setup unfinished)", async () => {
    const practiceId = await seedPractice(tdb, { geoKey: "demo:sandbox-lilly", email: SANDBOX_EMAIL });
    // Connected + send scope granted + sender auto-captured, but the sequence id
    // was never pasted — exactly the "connection exists, setup unfinished" state.
    await seedConnection(tdb, GRANTED, {
      sequenceId: null,
      senderEmail: SANDBOX_EMAIL,
      senderUserId: SENDER_USER_ID,
    });
    const { fetch: f, calls } = sendMock();

    const out = await sendBriefEmail(tdb.db, oauthDeps(f), {
      practiceId,
      touches: [{ touchNumber: 1, subject: "s", body: "b" }],
      encryptionKey: KEY,
      sandbox: SANDBOX,
      sentBy: SENT_BY,
    });
    expect(out).toMatchObject({
      ok: false,
      status: 503,
      error: "Send is not configured — finish HubSpot sequence setup",
    });
    expect(calls).toHaveLength(0); // no broken enroll — nothing left the process
  });

  it("reads the sequence + sender from the CONNECTION, not the args", async () => {
    // A DIFFERENT portal's identity proves the send path takes the sequence/sender
    // from the resolved connection row — not from any global/default.
    const practiceId = await seedPractice(tdb, { geoKey: "demo:sandbox-lilly", email: SANDBOX_EMAIL });
    await seedConnection(tdb, GRANTED, {
      sequenceId: "999000111",
      senderEmail: SANDBOX_EMAIL,
      senderUserId: "77",
    });
    const { fetch: f, calls } = sendMock();

    const out = await sendBriefEmail(tdb.db, oauthDeps(f), {
      practiceId,
      touches: [{ touchNumber: 1, subject: "s", body: "b" }],
      encryptionKey: KEY,
      sandbox: SANDBOX,
      sentBy: SENT_BY,
    });
    expect(out).toMatchObject({ ok: true, enrolled: true });
    const enroll = calls.find((c) => c.path.endsWith("/enrollments"));
    expect(enroll?.query.get("userId")).toBe("77");
    expect(enroll?.body).toMatchObject({ sequenceId: "999000111" });
  });

  it("records the shared 'sent' state (who + when) after a successful send", async () => {
    const practiceId = await seedPractice(tdb, { geoKey: "demo:sandbox-lilly", email: SANDBOX_EMAIL });
    await seedConnection(tdb, GRANTED);
    const { fetch: f } = sendMock();

    const out = await sendBriefEmail(tdb.db, oauthDeps(f), {
      practiceId,
      touches: [{ touchNumber: 1, subject: "s", body: "b" }],
      encryptionKey: KEY,
      sandbox: SANDBOX,
      sentBy: SENT_BY,
    });
    expect(out).toMatchObject({ ok: true, sentBy: SENT_BY });
    if (out.ok) expect(typeof out.sentAt).toBe("string");

    // The shared record every AE's Send button reads is now 'sent', stamped with the AE.
    const state = await getSendState(tdb.db, practiceId);
    expect(state).toMatchObject({ status: "sent", sentBy: SENT_BY });
    expect(state?.sentAt).toBeInstanceOf(Date);
  });

  it("turns away a concurrent 2nd send with 409 — BEFORE any HubSpot call (shared workspace)", async () => {
    const practiceId = await seedPractice(tdb, { geoKey: "demo:sandbox-lilly", email: SANDBOX_EMAIL });
    await seedConnection(tdb, GRANTED);

    // A first AE has already claimed this lead (mid-send or done).
    const first = await claimSend(tdb.db, practiceId, "first@opterra.test");
    expect(first.ok).toBe(true);

    const { fetch: f, calls } = sendMock();
    const out = await sendBriefEmail(tdb.db, oauthDeps(f), {
      practiceId,
      touches: [{ touchNumber: 1, subject: "s", body: "b" }],
      encryptionKey: KEY,
      sandbox: SANDBOX,
      sentBy: SENT_BY,
    });
    expect(out).toMatchObject({ ok: false, status: 409, alreadySent: true });
    if (!out.ok) expect(out.error).toContain("first@opterra.test");
    expect(calls).toHaveLength(0); // the loser never reached HubSpot — no duplicate enroll
  });

  it("releases the claim when the send FAILS, so the lead can be retried", async () => {
    const practiceId = await seedPractice(tdb, { geoKey: "demo:sandbox-lilly", email: SANDBOX_EMAIL });
    await seedConnection(tdb, GRANTED);

    // A mock whose push succeeds but whose enrollment step 400s.
    const failing = mockFetch((call) => {
      const { method, path } = call;
      if (method === "POST" && path === "/oauth/v1/token") {
        return { body: { access_token: "at_fresh", refresh_token: "rt_2", expires_in: 1800 } };
      }
      if (method === "POST" && path.endsWith("/objects/companies")) return { body: { id: "co_1" } };
      if (method === "POST" && path === "/crm/v3/objects/contacts/batch/upsert") {
        return { body: { results: [{ id: "ct_1", new: true }] } };
      }
      if (method === "PUT" && /\/crm\/v4\/objects\/.+\/associations\/default\//.test(path)) {
        return { status: 200, body: {} };
      }
      if (method === "POST" && path.endsWith("/objects/deals")) return { body: { id: "dl_1" } };
      if (method === "PATCH" && path.startsWith("/crm/v3/objects/contacts/")) {
        return { body: { id: "ct_1" } };
      }
      if (method === "POST" && path.endsWith("/enrollments")) {
        return { status: 400, body: { category: "VALIDATION_ERROR" } };
      }
      return { status: 404, body: { path } };
    });

    await expect(
      sendBriefEmail(tdb.db, oauthDeps(failing.fetch), {
        practiceId,
        touches: [{ touchNumber: 1, subject: "s", body: "b" }],
        encryptionKey: KEY,
        sandbox: SANDBOX,
        sentBy: SENT_BY,
      }),
    ).rejects.toBeTruthy();

    // The failed send left NO stuck claim — the lead is free again, so a retry can
    // re-claim it (vs. a lead permanently stuck "sending" after one bad send).
    expect(await getSendState(tdb.db, practiceId)).toBeNull();
    const reclaim = await claimSend(tdb.db, practiceId, SENT_BY);
    expect(reclaim.ok).toBe(true);
  });

  it("surfaces a fixable message and releases the claim when the Sales seat is inactive", async () => {
    const practiceId = await seedPractice(tdb, { geoKey: "demo:sandbox-lilly", email: SANDBOX_EMAIL });
    await seedConnection(tdb, GRANTED);
    // HubSpot's real rejection when the sending user has no active Sales Hub seat.
    const { fetch: f } = enrollFailsMock({
      status: "error",
      message: "Sales Subscription Status is not OK",
      errorType: "SequenceError.OTHER_SEND_REJECTED",
    });

    const out = await sendBriefEmail(tdb.db, oauthDeps(f), {
      practiceId,
      touches: [{ touchNumber: 1, subject: "s", body: "b" }],
      encryptionKey: KEY,
      sandbox: SANDBOX,
      sentBy: SENT_BY,
    });

    // A clear, user-fixable message (not the generic 502), and NOT a lock (alreadySent).
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.status).toBe(422);
      expect(out.error).toMatch(/Sales Hub/i);
      expect(out.alreadySent).toBeFalsy();
    }
    // Nothing shipped: the claim is released so the AE can retry after fixing HubSpot.
    expect(await getSendState(tdb.db, practiceId)).toBeNull();
  });

  it("surfaces a fixable message when the sending inbox is not connected", async () => {
    const practiceId = await seedPractice(tdb, { geoKey: "demo:sandbox-lilly", email: SANDBOX_EMAIL });
    await seedConnection(tdb, GRANTED);
    const { fetch: f } = enrollFailsMock({ category: "PUBLIC_ENROLL_NO_CONNECTED_EMAILS" });

    const out = await sendBriefEmail(tdb.db, oauthDeps(f), {
      practiceId,
      touches: [{ touchNumber: 1, subject: "s", body: "b" }],
      encryptionKey: KEY,
      sandbox: SANDBOX,
      sentBy: SENT_BY,
    });

    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.status).toBe(422);
      expect(out.error).toMatch(/inbox/i);
    }
    expect(await getSendState(tdb.db, practiceId)).toBeNull();
  });
});
