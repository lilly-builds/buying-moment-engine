import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHubSpotAdapter } from "@/src/crm/hubspot";
import { ensureLeadProperties } from "@/src/crm/hubspot-properties";
import {
  hasSendScope,
  fetchTokenMeta,
  refreshAccessToken,
  type OAuthHttpDeps,
} from "@/src/crm/hubspot-oauth";
import type { CrmLinkRef, LeadInput } from "@/src/crm/adapter";

/**
 * LIVE smoke against a real HubSpot portal (U10 verification; U15 re-runs it).
 *
 * SKIPPED unless `HUBSPOT_LIVE_REFRESH_TOKEN` is set, so CI stays hermetic — the
 * build plan puts "at least one real-call smoke per external integration" in the
 * seeding pass, never in CI.
 *
 *   HUBSPOT_LIVE_REFRESH_TOKEN=... pnpm vitest run tests/crm/hubspot-live.test.ts
 *
 * D9: the practice is SYNTHETIC (an RFC-2606 `example.com` domain) and the contact
 * is a made-up business role — no real practice, no real person, no PHI. Every
 * record it creates is archived in `afterAll`.
 */

const REFRESH_TOKEN = process.env.HUBSPOT_LIVE_REFRESH_TOKEN;
const CLIENT_ID = process.env.HUBSPOT_CLIENT_ID;
const CLIENT_SECRET = process.env.HUBSPOT_CLIENT_SECRET;
const REDIRECT_URI = process.env.HUBSPOT_REDIRECT_URI;

const live = REFRESH_TOKEN && CLIENT_ID && CLIENT_SECRET && REDIRECT_URI;

/**
 * Synthetic and unmistakably fake. The domain is under `example.com`, reserved by
 * RFC 2606 for documentation, because HubSpot VALIDATES the email property and
 * rejects the `.invalid` TLD outright (`400 INVALID_EMAIL`, verified live).
 */
const SMOKE_LEAD: LeadInput = {
  companyName: "ZZ GTM Maestro Smoke Test",
  domain: "gtm-maestro-smoke.example.com",
  city: "Austin",
  state: "TX",
  contact: {
    name: "Smoke Test",
    role: "Practice Manager",
    email: "smoke-test@gtm-maestro-smoke.example.com",
    linkedinUrl: "https://www.linkedin.com/in/smoke-test-not-a-real-person",
  },
  tags: {
    vertical: "dermatology",
    signalSource: "staffing-spike",
    signalCount: 3,
    aeQuality: null,
  },
};

describe.skipIf(!live)("LIVE HubSpot smoke (real portal)", () => {
  let accessToken = "";
  let oauthDeps: OAuthHttpDeps;
  let adapter: ReturnType<typeof createHubSpotAdapter>;
  const ref: CrmLinkRef = {};

  beforeAll(async () => {
    oauthDeps = {
      fetch,
      clientId: CLIENT_ID!,
      clientSecret: CLIENT_SECRET!,
      redirectUri: REDIRECT_URI!,
    };
    // Exercises the real refresh path, not just a pasted access token.
    const tokens = await refreshAccessToken(oauthDeps, REFRESH_TOKEN!);
    accessToken = tokens.accessToken;
    adapter = createHubSpotAdapter({
      fetch,
      getAccessToken: async () => accessToken,
    });
  }, 60_000);

  afterAll(async () => {
    // Archive everything this smoke created, whatever happened above.
    const del = async (objectType: string, id?: string | null) => {
      if (!id) return;
      await fetch(`https://api.hubapi.com/crm/v3/objects/${objectType}/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${accessToken}` },
      });
    };
    await del("deals", ref.dealId);
    await del("contacts", ref.contactId);
    await del("companies", ref.companyId);
  }, 60_000);

  it("refreshes an access token and reads its granted scopes", async () => {
    expect(accessToken.length).toBeGreaterThan(20);
    const meta = await fetchTokenMeta(oauthDeps, accessToken);
    expect(meta.hubId).toMatch(/^\d+$/);
    // Whatever the portal granted, the gate must agree with it.
    expect(hasSendScope(meta.scopes)).toBe(
      meta.scopes.includes("automation.sequences.enrollments.write"),
    );
  }, 60_000);

  it("provisions the tag properties, and a second run is a no-op", async () => {
    const first = await ensureLeadProperties({
      fetch,
      getAccessToken: async () => accessToken,
    });
    expect(first.created.length + first.existing.length).toBe(8);

    const second = await ensureLeadProperties({
      fetch,
      getAccessToken: async () => accessToken,
    });
    expect(second.created).toHaveLength(0);
    expect(second.existing).toHaveLength(8);
  }, 120_000);

  it("pushes a synthetic lead as company + contact + deal carrying the tags", async () => {
    const result = await adapter.pushLead(SMOKE_LEAD, null, async (progress) => {
      Object.assign(ref, progress);
    });
    Object.assign(ref, result);

    expect(result.created).toBe(true);
    expect(result.companyId).toMatch(/^\d+$/);
    expect(result.contactId).toMatch(/^\d+$/);
    expect(result.dealId).toMatch(/^\d+$/);

    // Read the company straight back — the tags must be ON the record.
    const res = await fetch(
      `https://api.hubapi.com/crm/v3/objects/companies/${result.companyId}` +
        `?properties=name,vertical,signal_source,signal_count`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    expect(res.status).toBe(200);
    const company = (await res.json()) as { properties: Record<string, string> };
    expect(company.properties.vertical).toBe("dermatology");
    expect(company.properties.signal_source).toBe("staffing-spike");
    expect(company.properties.signal_count).toBe("3");
  }, 120_000);

  it("re-pushing the SAME lead updates in place — never duplicates", async () => {
    const again = await adapter.pushLead(SMOKE_LEAD, ref);
    expect(again.created).toBe(false);
    expect(again.companyId).toBe(ref.companyId);
    expect(again.contactId).toBe(ref.contactId);
    expect(again.dealId).toBe(ref.dealId);
  }, 120_000);

  it("tags the AE verdict onto the live records", async () => {
    await adapter.tagLead(ref, { aeQuality: "up" });
    const res = await fetch(
      `https://api.hubapi.com/crm/v3/objects/companies/${ref.companyId}?properties=ae_quality`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    const company = (await res.json()) as { properties: Record<string, string> };
    expect(company.properties.ae_quality).toBe("up");
  }, 120_000);

  it("reads the deal stage back; a brand-new deal has no cycle time", async () => {
    const readback = await adapter.recordStage(ref);
    expect(readback.stage).toBeTruthy();
    expect(readback.enteredAt).toBeInstanceOf(Date);
    // Never entered closedwon, so there is no sales cycle to report.
    expect(readback.closedAt).toBeNull();
    expect(readback.cycleTimeDays).toBeNull();
  }, 120_000);
});
