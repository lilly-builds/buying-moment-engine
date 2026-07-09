import { describe, expect, it } from "vitest";
import {
  createOutreachAdapter,
  OutreachGatedError,
  outreachEnrollmentPayload,
  outreachRefreshForm,
} from "@/src/outreach/adapter";
import { RealPracticeSendBlockedError } from "@/src/send/guard";
import type { Recipient, SendTouchInput } from "@/src/send/adapter";
import { mockFetch } from "../crm/mock-fetch";

const sandbox = { allowedDomains: ["sandbox.test"] };
const recipient: Recipient = {
  contactId: "prospect_1",
  email: "qa@sandbox.test",
  classification: "sandbox",
};
const touch: SendTouchInput = { recipient, touchNumber: 1, subject: "hi", body: "hello", cta: "book a call" };

describe("Outreach adapter — inert without credentials (the demo state)", () => {
  it("throws OutreachGatedError and makes ZERO network calls (spy)", async () => {
    const { fetch: f, calls } = mockFetch(() => ({ body: {} }));
    const adapter = createOutreachAdapter({
      credentials: {}, // no OAuth set → gated OFF
      sequenceId: "seq_1",
      sandbox,
      fetch: f,
    });
    await expect(adapter.sendTouch(touch)).rejects.toThrow(OutreachGatedError);
    expect(calls).toHaveLength(0);
  });

  it("stays inert with a PARTIAL credential set", async () => {
    const { fetch: f, calls } = mockFetch(() => ({ body: {} }));
    const adapter = createOutreachAdapter({
      credentials: { clientId: "cid", clientSecret: "csecret" }, // missing refresh token
      sequenceId: "seq_1",
      sandbox,
      fetch: f,
    });
    await expect(adapter.sendTouch(touch)).rejects.toThrow(OutreachGatedError);
    expect(calls).toHaveLength(0);
  });
});

describe("Outreach adapter — contract when credentialed (mocked OAuth; never live)", () => {
  const credentials = { clientId: "cid", clientSecret: "csecret", refreshToken: "rt" };

  it("exchanges the refresh token, then posts a sequenceState enrollment", async () => {
    const { fetch: f, calls } = mockFetch((call) => {
      if (call.path === "/oauth/token") {
        return { body: { access_token: "ot_access", token_type: "bearer" } };
      }
      if (call.path === "/api/v2/sequenceStates") {
        return { status: 201, body: { data: { id: "ss_1" } } };
      }
      return { status: 404, body: {} };
    });

    const adapter = createOutreachAdapter({
      credentials,
      sequenceId: "seq_9",
      sandbox,
      fetch: f,
      tokenUrl: "https://api.outreach.test/oauth/token",
      baseUrl: "https://api.outreach.test",
    });

    const result = await adapter.sendTouch(touch);
    expect(result).toEqual({
      provider: "outreach",
      contactId: "prospect_1",
      touchNumber: 1,
      enrolled: true,
    });

    // Token exchange: a refresh_token grant carrying the OAuth client set.
    const tokenForm = new URLSearchParams(String(calls[0].body));
    expect(calls[0].path).toBe("/oauth/token");
    expect(tokenForm.get("grant_type")).toBe("refresh_token");
    expect(tokenForm.get("refresh_token")).toBe("rt");

    // Enrollment: JSON:API sequenceState relating the prospect to the sequence,
    // on the fresh bearer token.
    const enroll = calls[1];
    expect(enroll.path).toBe("/api/v2/sequenceStates");
    expect(enroll.authorization).toBe("Bearer ot_access");
    expect(enroll.body).toEqual(outreachEnrollmentPayload(touch, "seq_9"));
  });

  it("STILL blocks a real-practice recipient even when credentialed (D9)", async () => {
    const { fetch: f, calls } = mockFetch(() => ({ body: {} }));
    const adapter = createOutreachAdapter({
      credentials,
      sequenceId: "seq_9",
      sandbox,
      fetch: f,
    });
    const real: Recipient = { contactId: "p_real", email: "owner@real.com", classification: "real_practice" };
    await expect(
      adapter.sendTouch({ recipient: real, touchNumber: 1, subject: "hi", body: "hi" }),
    ).rejects.toThrow(RealPracticeSendBlockedError);
    expect(calls).toHaveLength(0);
  });
});

describe("Outreach payload builders (pure)", () => {
  it("refresh form carries the OAuth client set", () => {
    const form = outreachRefreshForm({ clientId: "a", clientSecret: "b", refreshToken: "c" });
    expect(form).toMatchObject({ grant_type: "refresh_token", client_id: "a", refresh_token: "c" });
  });
});
