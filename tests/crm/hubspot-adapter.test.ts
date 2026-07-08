import { describe, expect, it } from "vitest";
import {
  backoffDelayMs,
  createHubSpotAdapter,
  encodeTags,
  PREFIXED_TAG_KEY,
  type HubSpotDeps,
} from "@/src/crm/hubspot";
import type { LeadInput } from "@/src/crm/adapter";
import { hubspotApiMock, mockFetch, type FetchCall } from "./mock-fetch";

const LEAD: LeadInput = {
  companyName: "Georgia Dermatology",
  domain: "gaderm.example.com",
  city: "Atlanta",
  state: "GA",
  contact: { name: "Jane Doe", role: "Practice Manager", email: "jane@gaderm.example.com" },
  tags: {
    vertical: "dermatology",
    signalSource: "greenhouse",
    signalCount: 2,
    aeQuality: "up",
  },
};

function deps(over: Partial<HubSpotDeps>): HubSpotDeps {
  return {
    fetch,
    getAccessToken: async () => "test-token",
    sleep: async () => {},
    ...over,
  };
}

function bodyProps(call: FetchCall): Record<string, string> {
  const b = call.body as { properties?: Record<string, string> };
  return b.properties ?? {};
}

describe("createHubSpotAdapter.pushLead", () => {
  it("creates company + contact + deal carrying all four tags", async () => {
    const mock = hubspotApiMock();
    const adapter = createHubSpotAdapter(deps({ fetch: mock.fetch }));

    const result = await adapter.pushLead(LEAD);

    expect(result).toEqual({
      companyId: "co_1",
      contactId: "ct_1",
      dealId: "dl_1",
      created: true,
    });

    const companyPost = mock.calls.find(
      (c) => c.method === "POST" && c.path.endsWith("/companies"),
    )!;
    const props = bodyProps(companyPost);
    expect(props.vertical).toBe("dermatology");
    expect(props.signal_source).toBe("greenhouse");
    expect(props.signal_count).toBe("2");
    expect(props.ae_quality).toBe("up");

    // company + contact + deal all created
    expect(mock.calls.filter((c) => c.method === "POST").map((c) => c.path)).toEqual([
      "/crm/v3/objects/companies",
      "/crm/v3/objects/contacts",
      "/crm/v3/objects/deals",
    ]);

    // the deal also carries the tags (pipeline reports slice by them)
    const dealPost = mock.calls.find((c) => c.path.endsWith("/deals"))!;
    expect(bodyProps(dealPost).signal_source).toBe("greenhouse");
  });

  it("re-pushing the same lead UPDATES (PATCH) instead of duplicating", async () => {
    const mock = hubspotApiMock();
    const adapter = createHubSpotAdapter(deps({ fetch: mock.fetch }));

    const existing = { companyId: "co_1", contactId: "ct_1", dealId: "dl_1" };
    const result = await adapter.pushLead(
      { ...LEAD, tags: { ...LEAD.tags, aeQuality: "down" } },
      existing,
    );

    expect(result.created).toBe(false);
    expect(result.companyId).toBe("co_1");
    // NO create calls — every write is a PATCH to the stored ids
    expect(mock.calls.every((c) => c.method === "PATCH")).toBe(true);
    expect(mock.calls.map((c) => c.path)).toEqual([
      "/crm/v3/objects/companies/co_1",
      "/crm/v3/objects/contacts/ct_1",
      "/crm/v3/objects/deals/dl_1",
    ]);
    expect(bodyProps(mock.calls[0]).ae_quality).toBe("down");
  });
});

describe("createHubSpotAdapter.tagLead (ae_quality 👍 -> 👎)", () => {
  it("PATCHes the ae_quality property on the company and the deal", async () => {
    const mock = hubspotApiMock();
    const adapter = createHubSpotAdapter(deps({ fetch: mock.fetch }));

    await adapter.tagLead(
      { companyId: "co_1", dealId: "dl_1" },
      { aeQuality: "down" },
    );

    expect(mock.calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      "PATCH /crm/v3/objects/companies/co_1",
      "PATCH /crm/v3/objects/deals/dl_1",
    ]);
    expect(bodyProps(mock.calls[0])).toEqual({ ae_quality: "down" });
    expect(bodyProps(mock.calls[1])).toEqual({ ae_quality: "down" });
  });
});

describe("createHubSpotAdapter 429 handling", () => {
  it("retries with backoff after a 429 and loses nothing", async () => {
    let companyPosts = 0;
    const slept: number[] = [];
    const { fetch: f, calls } = mockFetch((call) => {
      if (call.method === "POST" && call.path.endsWith("/companies")) {
        companyPosts += 1;
        if (companyPosts === 1) {
          return { status: 429, headers: { "Retry-After": "0" }, body: { message: "rate limited" } };
        }
        return { body: { id: "co_1", properties: (call.body as { properties: unknown }).properties } };
      }
      if (call.path.endsWith("/contacts")) return { body: { id: "ct_1" } };
      if (call.path.endsWith("/deals")) return { body: { id: "dl_1" } };
      return { status: 404, body: {} };
    });

    const adapter = createHubSpotAdapter(
      deps({ fetch: f, sleep: async (ms) => { slept.push(ms); } }),
    );
    const result = await adapter.pushLead(LEAD);

    expect(result.companyId).toBe("co_1");
    expect(companyPosts).toBe(2); // one 429, one success — retried, nothing lost
    expect(slept.length).toBe(1); // backed off exactly once
    // downstream contact + deal still created
    expect(calls.some((c) => c.path.endsWith("/contacts"))).toBe(true);
    expect(calls.some((c) => c.path.endsWith("/deals"))).toBe(true);
  });
});

describe("createHubSpotAdapter.recordStage (cycle-time read-back)", () => {
  it("reads dealstage + computes cycle time from createdate -> closedate", async () => {
    const mock = hubspotApiMock({
      deal: {
        dealstage: "closedwon",
        createdate: "2026-07-01T00:00:00Z",
        closedate: "2026-07-04T00:00:00Z",
      },
    });
    const adapter = createHubSpotAdapter(deps({ fetch: mock.fetch }));

    const readback = await adapter.recordStage({ dealId: "dl_1" });

    expect(readback.stage).toBe("closedwon");
    expect(readback.cycleTimeDays).toBe(3);
    const get = mock.calls.find((c) => c.method === "GET")!;
    expect(get.path).toBe("/crm/v3/objects/deals/dl_1");
    expect(get.query.get("properties")).toBe("dealstage,createdate,closedate");
  });

  it("returns a null cycle time for an open deal (no closedate)", async () => {
    const mock = hubspotApiMock({
      deal: { dealstage: "appointmentscheduled", createdate: "2026-07-01T00:00:00Z" },
    });
    const adapter = createHubSpotAdapter(deps({ fetch: mock.fetch }));
    const readback = await adapter.recordStage({ dealId: "dl_9" });
    expect(readback.stage).toBe("appointmentscheduled");
    expect(readback.cycleTimeDays).toBeNull();
  });
});

describe("pure property + backoff helpers", () => {
  it("encodeTags 'custom' mode emits one property per tag", () => {
    expect(
      encodeTags(
        { vertical: "dermatology", signalSource: "greenhouse", signalCount: 2, aeQuality: "up" },
        "custom",
      ),
    ).toEqual({
      vertical: "dermatology",
      signal_source: "greenhouse",
      signal_count: "2",
      ae_quality: "up",
    });
  });

  it("encodeTags 'prefixed' fallback packs all four into one property", () => {
    const out = encodeTags(
      { vertical: "dermatology", signalSource: "greenhouse", signalCount: 2, aeQuality: "up" },
      "prefixed",
    );
    expect(Object.keys(out)).toEqual([PREFIXED_TAG_KEY]);
    expect(out[PREFIXED_TAG_KEY]).toBe(
      "vertical=dermatology;signal_source=greenhouse;signal_count=2;ae_quality=up",
    );
  });

  it("encodeTags omits an unset ae_quality (no vote yet)", () => {
    const out = encodeTags(
      { vertical: "dermatology", signalSource: "greenhouse", signalCount: 1 },
      "custom",
    );
    expect(out.ae_quality).toBeUndefined();
  });

  it("backoffDelayMs honors Retry-After, else exponential, capped", () => {
    expect(backoffDelayMs(0, 500)).toBe(500);
    expect(backoffDelayMs(1, 500)).toBe(1000);
    expect(backoffDelayMs(3, 500)).toBe(4000);
    expect(backoffDelayMs(0, 500, 2)).toBe(2000); // Retry-After: 2s wins
    expect(backoffDelayMs(20, 500)).toBe(30_000); // capped
  });
});
