import { describe, expect, it } from "vitest";
import type { Recipient } from "@/src/send/adapter";
import {
  createHubSpotSender,
  CUSTOM_BODY_PROPERTY,
  CUSTOM_SUBJECT_PROPERTY,
  HUBSPOT_SEQUENCES_VERSION,
  MAX_CUSTOM_BODY_CHARS,
  SEND_PROPERTY_NAMES,
  BodyTooLongError,
  touchPropertyPair,
  type HubSpotSendDeps,
} from "@/src/send/hubspot-send";
import { RealPracticeSendBlockedError } from "@/src/send/guard";
import { mockFetch, type FetchCall } from "../crm/mock-fetch";

/**
 * A HubSpot mock for the send surface: property provisioning, PATCH, enroll.
 * Property creates are idempotent (409 on repeat), tracked by the actual property
 * name — the sender now provisions six (subject + body for each of three touches).
 */
function sendMock() {
  const props = new Set<string>();
  return mockFetch((call) => {
    const { method, path, body } = call;
    if (method === "POST" && path === "/crm/v3/properties/contacts/groups") {
      return { status: 201, body: {} };
    }
    if (method === "POST" && path === "/crm/v3/properties/contacts") {
      const name = String((body as { name?: unknown })?.name ?? "");
      if (props.has(name)) {
        return { status: 409, body: { category: "OBJECT_ALREADY_EXISTS" } };
      }
      props.add(name);
      return { status: 201, body: { name } };
    }
    if (method === "PATCH" && path.startsWith("/crm/v3/objects/contacts/")) {
      return { status: 200, body: { id: path.split("/").pop() } };
    }
    if (method === "POST" && path.includes("/sequences/") && path.endsWith("/enrollments")) {
      return { status: 201, body: { enrollmentId: "enr_1" } };
    }
    return { status: 404, body: { path } };
  });
}

function deps(fetchImpl: typeof fetch): HubSpotSendDeps {
  return {
    fetch: fetchImpl,
    getAccessToken: async () => "at_test",
    baseUrl: "https://api.hubapi.test",
    sequenceId: "seq_99",
    senderEmail: "rep@sandbox.test",
    userId: "user_7",
    sandbox: { allowedDomains: ["sandbox.test"] },
  };
}

const sandboxRecipient: Recipient = {
  contactId: "ct_42",
  email: "qa@sandbox.test",
  classification: "sandbox",
};

function findCall(calls: FetchCall[], pred: (c: FetchCall) => boolean): FetchCall {
  const c = calls.find(pred);
  if (!c) throw new Error("expected call not found");
  return c;
}

describe("HubSpot send — whole-body-token fidelity (experiment #2)", () => {
  it("writes the EXACT subject + multi-line body into the custom properties and enrolls", async () => {
    const { fetch: f, calls } = sendMock();
    const sender = createHubSpotSender(deps(f));

    const subject = "Losing the phone battle around screening season?";
    const body =
      "Hi Dana,\n\nSaw you're hiring 3 front-desk coordinators — the phones are winning.\n\n" +
      "EliseAI answers every call, books the appt, and never puts a patient on hold.\n\n— Rep";

    const result = await sender.sendTouch({
      recipient: sandboxRecipient,
      touchNumber: 1,
      subject,
      body,
    });

    expect(result).toEqual({
      provider: "hubspot",
      contactId: "ct_42",
      touchNumber: 1,
      enrolled: true,
    });

    // Subject + body are written VERBATIM (newlines intact) into the two properties.
    const patch = findCall(calls, (c) => c.method === "PATCH");
    expect(patch.path).toBe("/crm/v3/objects/contacts/ct_42");
    const patched = (patch.body as { properties: Record<string, string> }).properties;
    expect(patched[CUSTOM_SUBJECT_PROPERTY]).toBe(subject);
    expect(patched[CUSTOM_BODY_PROPERTY]).toBe(body);

    // The enrollment references the sequence, the contact, and the rep's inbox,
    // with the acting userId as a query param (HubSpot's contract).
    const enroll = findCall(calls, (c) => c.path.endsWith("/enrollments"));
    expect(enroll.path).toBe(`/automation/sequences/${HUBSPOT_SEQUENCES_VERSION}/enrollments`);
    expect(enroll.query.get("userId")).toBe("user_7");
    expect(enroll.body).toEqual({
      sequenceId: "seq_99",
      contactId: "ct_42",
      senderEmail: "rep@sandbox.test",
    });
  });

  it("provisions ALL per-touch properties AT MOST once per sender (idempotent)", async () => {
    const { fetch: f, calls } = sendMock();
    const sender = createHubSpotSender(deps(f));
    await sender.sendTouch({ recipient: sandboxRecipient, touchNumber: 1, subject: "s1", body: "one" });
    await sender.sendTouch({ recipient: sandboxRecipient, touchNumber: 2, subject: "s2", body: "two" });
    const propertyCreates = calls.filter(
      (c) => c.method === "POST" && c.path === "/crm/v3/properties/contacts",
    );
    // One create per send property (subject + body × 3 touches = 6), each created
    // once — never re-created across sends (memoised provisioning).
    expect(propertyCreates).toHaveLength(SEND_PROPERTY_NAMES.length);
    expect(propertyCreates).toHaveLength(6);
    // Every declared send property was actually provisioned.
    const created = new Set(
      propertyCreates.map((c) => String((c.body as { name?: unknown }).name)),
    );
    for (const name of SEND_PROPERTY_NAMES) expect(created.has(name)).toBe(true);
  });

  it("sendSequence writes all 3 touches' pairs in ONE PATCH and enrolls ONCE", async () => {
    const { fetch: f, calls } = sendMock();
    const sender = createHubSpotSender(deps(f));

    const touches = [
      { touchNumber: 1, subject: "s1", body: "Hi — worth 15 minutes?" },
      { touchNumber: 2, subject: "s2", body: "One thing worth sharing." },
      { touchNumber: 3, subject: "s3", body: "Closing the loop." },
    ];
    const result = await sender.sendSequence({ recipient: sandboxRecipient, touches });
    expect(result).toEqual({
      provider: "hubspot",
      contactId: "ct_42",
      touchNumber: 1,
      enrolled: true,
    });

    // Exactly ONE PATCH carrying all 6 values, each in its own pair.
    const patches = calls.filter((c) => c.method === "PATCH");
    expect(patches).toHaveLength(1);
    const props = (patches[0].body as { properties: Record<string, string> }).properties;
    expect(Object.keys(props)).toHaveLength(6);
    for (const t of touches) {
      const pair = touchPropertyPair(t.touchNumber);
      expect(props[pair.subject]).toBe(t.subject);
      expect(props[pair.body]).toBe(t.body);
    }
    // Touch 1 lands in the ORIGINAL unsuffixed pair (back-compat with the Sequence's step 1).
    expect(props[CUSTOM_SUBJECT_PROPERTY]).toBe("s1");
    expect(props[CUSTOM_BODY_PROPERTY]).toBe("Hi — worth 15 minutes?");

    // Exactly ONE enrollment — a contact can hold only one active enrollment.
    expect(calls.filter((c) => c.path.endsWith("/enrollments"))).toHaveLength(1);
  });

  it("sendSequence runs the D9 firewall FIRST — a real practice makes ZERO calls", async () => {
    const { fetch: f, calls } = sendMock();
    const sender = createHubSpotSender(deps(f));
    const real: Recipient = {
      contactId: "ct_real",
      email: "owner@real-derm.com",
      classification: "real_practice",
    };
    await expect(
      sender.sendSequence({
        recipient: real,
        touches: [{ touchNumber: 1, subject: "s", body: "b" }],
      }),
    ).rejects.toThrow(RealPracticeSendBlockedError);
    expect(calls).toHaveLength(0);
  });

  it("sendSequence rejects an over-long touch body before any network call", async () => {
    const { fetch: f, calls } = sendMock();
    const sender = createHubSpotSender(deps(f));
    await expect(
      sender.sendSequence({
        recipient: sandboxRecipient,
        touches: [
          { touchNumber: 1, subject: "ok", body: "fine" },
          { touchNumber: 2, subject: "ok", body: "x".repeat(MAX_CUSTOM_BODY_CHARS + 1) },
        ],
      }),
    ).rejects.toThrow(BodyTooLongError);
    expect(calls).toHaveLength(0);
  });

  it("provisionProperty:false makes ZERO schema calls — only PATCH + enroll (live grant)", async () => {
    const { fetch: f, calls } = sendMock();
    const sender = createHubSpotSender({ ...deps(f), provisionProperty: false });
    const result = await sender.sendTouch({
      recipient: sandboxRecipient,
      touchNumber: 1,
      subject: "hi",
      body: "hello",
    });
    expect(result.enrolled).toBe(true);
    // No /crm/v3/properties/* traffic — exactly what a grant without
    // crm.schemas.contacts.write can do: write subject + body + enroll.
    expect(calls.some((c) => c.path.startsWith("/crm/v3/properties/"))).toBe(false);
    expect(calls.map((c) => c.method).sort()).toEqual(["PATCH", "POST"]);
  });
});

describe("HubSpot send — D9 firewall (nothing fires at a real practice)", () => {
  it("BLOCKS a real-practice recipient and makes ZERO network calls (spy)", async () => {
    const { fetch: f, calls } = sendMock();
    const sender = createHubSpotSender(deps(f));
    const real: Recipient = {
      contactId: "ct_real",
      email: "owner@real-derm.com",
      classification: "real_practice",
    };
    await expect(
      sender.sendTouch({ recipient: real, touchNumber: 1, subject: "hi", body: "hi" }),
    ).rejects.toThrow(RealPracticeSendBlockedError);
    expect(calls).toHaveLength(0);
  });

  it("BLOCKS a sandbox-flagged recipient whose address is not registered (spy = 0)", async () => {
    const { fetch: f, calls } = sendMock();
    const sender = createHubSpotSender(deps(f));
    const smuggled: Recipient = {
      contactId: "ct_x",
      email: "owner@real-derm.com",
      classification: "sandbox",
    };
    await expect(
      sender.sendTouch({ recipient: smuggled, touchNumber: 1, subject: "hi", body: "hi" }),
    ).rejects.toThrow(RealPracticeSendBlockedError);
    expect(calls).toHaveLength(0);
  });
});

describe("HubSpot send — body length guard (experiment #2 limits)", () => {
  it("rejects an over-long body before any network call", async () => {
    const { fetch: f, calls } = sendMock();
    const sender = createHubSpotSender(deps(f));
    const tooLong = "x".repeat(MAX_CUSTOM_BODY_CHARS + 1);
    await expect(
      sender.sendTouch({ recipient: sandboxRecipient, touchNumber: 1, subject: "hi", body: tooLong }),
    ).rejects.toThrow(BodyTooLongError);
    expect(calls).toHaveLength(0);
  });
});
