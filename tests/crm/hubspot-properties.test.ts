import { describe, expect, it } from "vitest";
import { createHubSpotAdapter } from "@/src/crm/hubspot";
import {
  CUSTOM_MODE_PROPERTIES,
  ensureLeadProperties,
  LEAD_PROPERTY_GROUP,
  PREFIXED_MODE_PROPERTIES,
  propertiesForMode,
  propertyPayload,
  TAGGED_OBJECT_TYPES,
} from "@/src/crm/hubspot-properties";
import { PREFIXED_TAG_KEY } from "@/src/crm/tags";
import type { LeadInput } from "@/src/crm/adapter";
import { hubspotApiMock } from "./mock-fetch";

const LEAD: LeadInput = {
  companyName: "Georgia Dermatology",
  domain: "gaderm.example.com",
  city: "Atlanta",
  state: "GA",
  contact: { name: "Jane Doe", role: "Practice Manager" },
  tags: {
    vertical: "dermatology",
    signalSource: "staffing-spike",
    signalCount: 3,
    aeQuality: null,
  },
};

function deps(fetchImpl: typeof fetch, propertyMode?: "custom" | "prefixed") {
  return {
    fetch: fetchImpl,
    getAccessToken: async () => "tok",
    sleep: async () => {},
    propertyMode,
  };
}

describe("pure property specs", () => {
  it("custom mode declares exactly the four first-class tags", () => {
    expect(CUSTOM_MODE_PROPERTIES.map((p) => p.name)).toEqual([
      "vertical",
      "signal_source",
      "signal_count",
      "ae_quality",
    ]);
  });

  it("signal_count is numeric so HubSpot reports can sort 'how hot'", () => {
    const p = CUSTOM_MODE_PROPERTIES.find((x) => x.name === "signal_count")!;
    expect(p.type).toBe("number");
    expect(p.fieldType).toBe("number");
  });

  it("ae_quality options mirror the feedback_thumb pgEnum (up | down)", () => {
    const p = CUSTOM_MODE_PROPERTIES.find((x) => x.name === "ae_quality")!;
    expect(p.options?.map((o) => o.value)).toEqual(["up", "down"]);
  });

  it("prefixed fallback mode declares only the single packed property", () => {
    expect(PREFIXED_MODE_PROPERTIES.map((p) => p.name)).toEqual([PREFIXED_TAG_KEY]);
    expect(propertiesForMode("prefixed")).toBe(PREFIXED_MODE_PROPERTIES);
    expect(propertiesForMode("custom")).toBe(CUSTOM_MODE_PROPERTIES);
  });

  it("payload carries the group and omits `options` for non-enumerations", () => {
    const vertical = propertyPayload(CUSTOM_MODE_PROPERTIES[0]);
    expect(vertical.groupName).toBe(LEAD_PROPERTY_GROUP);
    expect(vertical).not.toHaveProperty("options");
    const ae = propertyPayload(CUSTOM_MODE_PROPERTIES[3]);
    expect(ae).toHaveProperty("options");
  });
});

describe("ensureLeadProperties", () => {
  it("creates the group + four properties on every tagged object type", async () => {
    const mock = hubspotApiMock({ freshPortal: true });
    const result = await ensureLeadProperties(deps(mock.fetch));

    expect(result.created).toHaveLength(TAGGED_OBJECT_TYPES.length * 4);
    expect(result.existing).toHaveLength(0);
    for (const objectType of TAGGED_OBJECT_TYPES) {
      expect(result.created).toContain(`${objectType}.vertical`);
      expect(result.created).toContain(`${objectType}.ae_quality`);
    }
  });

  it("creates the group BEFORE the properties that reference it", async () => {
    const mock = hubspotApiMock({ freshPortal: true });
    await ensureLeadProperties(deps(mock.fetch));

    const groupIdx = mock.calls.findIndex((c) =>
      c.path.endsWith("/properties/companies/groups"),
    );
    const firstPropIdx = mock.calls.findIndex(
      (c) => c.path === "/crm/v3/properties/companies",
    );
    expect(groupIdx).toBeGreaterThanOrEqual(0);
    expect(groupIdx).toBeLessThan(firstPropIdx);
  });

  it("is idempotent: a second run tolerates 409 and reports them as existing", async () => {
    const mock = hubspotApiMock({ freshPortal: true });
    await ensureLeadProperties(deps(mock.fetch));
    const second = await ensureLeadProperties(deps(mock.fetch));

    expect(second.created).toHaveLength(0);
    expect(second.existing).toHaveLength(TAGGED_OBJECT_TYPES.length * 4);
  });

  it("never PATCHes an existing property (R17: no blind overwrite)", async () => {
    const mock = hubspotApiMock({ freshPortal: true });
    await ensureLeadProperties(deps(mock.fetch));
    await ensureLeadProperties(deps(mock.fetch));

    const patches = mock.calls.filter(
      (c) => c.method === "PATCH" && c.path.startsWith("/crm/v3/properties/"),
    );
    expect(patches).toHaveLength(0);
  });

  it("prefixed mode provisions only the single packed property", async () => {
    const mock = hubspotApiMock({ freshPortal: true });
    const result = await ensureLeadProperties(deps(mock.fetch, "prefixed"));
    expect(result.created).toEqual([
      `companies.${PREFIXED_TAG_KEY}`,
      `deals.${PREFIXED_TAG_KEY}`,
    ]);
  });

  it("propagates a non-409 failure (403 MISSING_SCOPES) instead of silently passing", async () => {
    const forbidden = {
      fetch: (async () =>
        new Response(JSON.stringify({ category: "MISSING_SCOPES" }), {
          status: 403,
        })) as unknown as typeof fetch,
      getAccessToken: async () => "tok",
      sleep: async () => {},
    };
    await expect(ensureLeadProperties(forbidden)).rejects.toThrow(/403/);
  });
});

describe("REGRESSION: pushLead against a portal whose tag properties are missing", () => {
  it("fails with HubSpot's 400, exactly as the live portal does", async () => {
    // Captured live 2026-07-08: POST /crm/v3/objects/companies with `vertical`
    // present but not provisioned -> 400 PROPERTY_DOESNT_EXIST. Before the mock
    // enforced this, ~60 green tests hid a pushLead that could never have worked.
    const mock = hubspotApiMock({ freshPortal: true });
    const adapter = createHubSpotAdapter(deps(mock.fetch));

    await expect(adapter.pushLead(LEAD)).rejects.toThrow(/400/);
  });

  it("succeeds once ensureLeadProperties has provisioned them", async () => {
    const mock = hubspotApiMock({ freshPortal: true });
    await ensureLeadProperties(deps(mock.fetch));
    const adapter = createHubSpotAdapter(deps(mock.fetch));

    const result = await adapter.pushLead(LEAD);

    expect(result.companyId).toBe("co_1");
    expect(result.created).toBe(true);
    const post = mock.calls.find(
      (c) => c.method === "POST" && c.path === "/crm/v3/objects/companies",
    )!;
    expect((post.body as { properties: Record<string, string> }).properties).toMatchObject({
      vertical: "dermatology",
      signal_source: "staffing-spike",
      signal_count: "3",
    });
  });
});
