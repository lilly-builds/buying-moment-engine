import { describe, expect, it } from "vitest";
import type { Recipient } from "@/src/send/adapter";
import {
  createHubSpotSender,
  CUSTOM_BODY_PROPERTY,
  HUBSPOT_SEQUENCES_VERSION,
  MAX_CUSTOM_BODY_CHARS,
  BodyTooLongError,
  type HubSpotSendDeps,
} from "@/src/send/hubspot-send";
import { RealPracticeSendBlockedError } from "@/src/send/guard";
import { mockFetch, type FetchCall } from "../crm/mock-fetch";

/** A HubSpot mock for the send surface: property provisioning, PATCH, enroll. */
function sendMock() {
  const props = new Set<string>();
  return mockFetch((call) => {
    const { method, path } = call;
    if (method === "POST" && path === "/crm/v3/properties/contacts/groups") {
      return { status: 201, body: {} };
    }
    if (method === "POST" && path === "/crm/v3/properties/contacts") {
      if (props.has(CUSTOM_BODY_PROPERTY)) {
        return { status: 409, body: { category: "OBJECT_ALREADY_EXISTS" } };
      }
      props.add(CUSTOM_BODY_PROPERTY);
      return { status: 201, body: { name: CUSTOM_BODY_PROPERTY } };
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
  it("writes the EXACT multi-line body into the custom property and enrolls the contact", async () => {
    const { fetch: f, calls } = sendMock();
    const sender = createHubSpotSender(deps(f));

    const body =
      "Hi Dana,\n\nSaw you're hiring 3 front-desk coordinators — the phones are winning.\n\n" +
      "EliseAI answers every call, books the appt, and never puts a patient on hold.\n\n— Rep";

    const result = await sender.sendTouch({ recipient: sandboxRecipient, touchNumber: 1, body });

    expect(result).toEqual({
      provider: "hubspot",
      contactId: "ct_42",
      touchNumber: 1,
      enrolled: true,
    });

    // The body is written VERBATIM (newlines intact) into the one custom property.
    const patch = findCall(calls, (c) => c.method === "PATCH");
    expect(patch.path).toBe("/crm/v3/objects/contacts/ct_42");
    const patched = (patch.body as { properties: Record<string, string> }).properties;
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

  it("provisions the custom property AT MOST once per sender (idempotent)", async () => {
    const { fetch: f, calls } = sendMock();
    const sender = createHubSpotSender(deps(f));
    await sender.sendTouch({ recipient: sandboxRecipient, touchNumber: 1, body: "one" });
    await sender.sendTouch({ recipient: sandboxRecipient, touchNumber: 2, body: "two" });
    const propertyCreates = calls.filter(
      (c) => c.method === "POST" && c.path === "/crm/v3/properties/contacts",
    );
    expect(propertyCreates).toHaveLength(1);
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
      sender.sendTouch({ recipient: real, touchNumber: 1, body: "hi" }),
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
      sender.sendTouch({ recipient: smuggled, touchNumber: 1, body: "hi" }),
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
      sender.sendTouch({ recipient: sandboxRecipient, touchNumber: 1, body: tooLong }),
    ).rejects.toThrow(BodyTooLongError);
    expect(calls).toHaveLength(0);
  });
});
