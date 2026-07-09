import { beforeEach, describe, expect, it } from "vitest";
import { contacts } from "@/db/schema";
import { upsertPractice } from "@/db/ingest";
import { storeConnection } from "@/db/crm";
import { encrypt } from "@/src/crm/token-crypto";
import { HUBSPOT_SEND_SCOPE } from "@/src/crm/hubspot-oauth";
import type { OAuthHttpDeps } from "@/src/crm/hubspot-oauth";
import { sendBriefEmail } from "@/src/send/send-brief";
import type { HubSpotSendConfig } from "@/src/send/config";
import {
  CUSTOM_BODY_PROPERTY,
  CUSTOM_SUBJECT_PROPERTY,
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
const SEND_CONFIG: HubSpotSendConfig = {
  sequenceId: "712515259",
  senderEmail: SANDBOX_EMAIL,
  userId: "95142122",
  sandbox: { allowedEmails: [SANDBOX_EMAIL] },
};

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

async function seedConnection(tdb: TestDb, scopes: string): Promise<void> {
  await storeConnection(tdb.db, {
    provider: "hubspot",
    portalId: PORTAL,
    accessTokenEnc: encrypt("at_current", KEY),
    refreshTokenEnc: encrypt("rt_1", KEY),
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    scopes,
  });
}

const GRANTED = `crm.objects.companies.write crm.objects.contacts.write crm.objects.deals.write ${HUBSPOT_SEND_SCOPE}`;

describe("sendBriefEmail (U11 send orchestrator)", () => {
  let tdb: TestDb;
  beforeEach(async () => {
    tdb = await createTestDb();
  });

  it("enrolls a sandbox lead and writes the edited subject + body", async () => {
    const practiceId = await seedPractice(tdb, { geoKey: "demo:sandbox-lilly", email: SANDBOX_EMAIL });
    await seedConnection(tdb, GRANTED);
    const { fetch: f, calls } = sendMock();

    const out = await sendBriefEmail(tdb.db, oauthDeps(f), {
      practiceId,
      subject: "3 new front-desk reqs",
      body: "Hi Lilly — worth 15 minutes?",
      encryptionKey: KEY,
      sendConfig: SEND_CONFIG,
    });

    expect(out).toMatchObject({ ok: true, enrolled: true });

    // The custom-property PATCH carried the AE's EXACT edited subject + body.
    const patch = calls.find((c) => c.method === "PATCH" && c.path.startsWith("/crm/v3/objects/contacts/"));
    const props = (patch?.body as { properties?: Record<string, string> })?.properties ?? {};
    expect(props[CUSTOM_SUBJECT_PROPERTY]).toBe("3 new front-desk reqs");
    expect(props[CUSTOM_BODY_PROPERTY]).toBe("Hi Lilly — worth 15 minutes?");

    // The enrollment fired, with the configured sequence + sender.
    const enroll = calls.find((c) => c.path.endsWith("/enrollments"));
    expect(enroll).toBeTruthy();
    expect(enroll?.query.get("userId")).toBe("95142122");
    expect(enroll?.body).toMatchObject({ sequenceId: "712515259", senderEmail: SANDBOX_EMAIL });
  });

  it("BLOCKS a real practice before ANY network I/O (D9)", async () => {
    // A real discovered practice (no demo: prefix) classifies real_practice, even
    // though its address happens to be the registered sandbox one.
    const practiceId = await seedPractice(tdb, { geoKey: "austin-tx", email: SANDBOX_EMAIL });
    await seedConnection(tdb, GRANTED);
    const { fetch: f, calls } = sendMock();

    const out = await sendBriefEmail(tdb.db, oauthDeps(f), {
      practiceId,
      subject: "s",
      body: "b",
      encryptionKey: KEY,
      sendConfig: SEND_CONFIG,
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
      subject: "s",
      body: "b",
      encryptionKey: KEY,
      sendConfig: SEND_CONFIG,
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
      subject: "s",
      body: "b",
      encryptionKey: KEY,
      sendConfig: SEND_CONFIG,
    });
    expect(out).toMatchObject({ ok: false, status: 422 });
  });

  it("409s when no HubSpot connection is stored", async () => {
    const practiceId = await seedPractice(tdb, { geoKey: "demo:sandbox-lilly", email: SANDBOX_EMAIL });
    const { fetch: f } = sendMock();

    const out = await sendBriefEmail(tdb.db, oauthDeps(f), {
      practiceId,
      subject: "s",
      body: "b",
      encryptionKey: KEY,
      sendConfig: SEND_CONFIG,
    });
    expect(out).toMatchObject({ ok: false, status: 409 });
  });

  it("403s when the connection lacks the Sequences send scope", async () => {
    const practiceId = await seedPractice(tdb, { geoKey: "demo:sandbox-lilly", email: SANDBOX_EMAIL });
    await seedConnection(tdb, "crm.objects.contacts.write"); // no send scope granted
    const { fetch: f, calls } = sendMock();

    const out = await sendBriefEmail(tdb.db, oauthDeps(f), {
      practiceId,
      subject: "s",
      body: "b",
      encryptionKey: KEY,
      sendConfig: SEND_CONFIG,
    });
    expect(out).toMatchObject({ ok: false, status: 403 });
    expect(calls).toHaveLength(0); // scope check is before any HubSpot call
  });
});
