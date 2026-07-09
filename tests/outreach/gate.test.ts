import { describe, expect, it } from "vitest";
import {
  isOutreachActivatable,
  OUTREACH_AWAITING_MESSAGE,
  outreachGateStatus,
  readOutreachCredentials,
  type OutreachCredentials,
} from "@/src/outreach/gate";

const full: OutreachCredentials = {
  clientId: "cid",
  clientSecret: "csecret",
  refreshToken: "rt",
};

describe("Outreach gate (pure) — built, but off", () => {
  it("is activatable ONLY when all three OAuth values are present", () => {
    expect(isOutreachActivatable(full)).toBe(true);
    expect(isOutreachActivatable({ clientId: "cid", clientSecret: "csecret" })).toBe(false);
    expect(isOutreachActivatable({ refreshToken: "rt" })).toBe(false);
    expect(isOutreachActivatable({})).toBe(false);
  });

  it("renders the honest 'awaiting credentials' state when dark (the UI copy)", () => {
    const status = outreachGateStatus({});
    expect(status.credentialed).toBe(false);
    expect(status.state).toBe("awaiting_credentials");
    expect(status.message).toBe(OUTREACH_AWAITING_MESSAGE);
    expect(status.message).toBe("ready — awaiting Outreach credentials");
  });

  it("reports credentialed once the full set is present", () => {
    const status = outreachGateStatus(full);
    expect(status.credentialed).toBe(true);
    expect(status.state).toBe("credentialed");
  });

  it("reads the three OAuth values from env, treating empty strings as absent", () => {
    const creds = readOutreachCredentials({
      OUTREACH_CLIENT_ID: "cid",
      OUTREACH_CLIENT_SECRET: "",
      OUTREACH_REFRESH_TOKEN: undefined,
    });
    expect(creds.clientId).toBe("cid");
    expect(creds.clientSecret).toBeUndefined();
    expect(creds.refreshToken).toBeUndefined();
    expect(isOutreachActivatable(creds)).toBe(false);
  });
});
