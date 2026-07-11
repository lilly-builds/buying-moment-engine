import { describe, expect, it } from "vitest";
import { generateDraftConfig } from "@/src/adapt/generate";
import { DraftWorkspaceConfigSchema, type GenerateInput } from "@/src/adapt/schema";
import { FakeAdaptClient } from "./doubles";

const INPUT: GenerateInput = {
  companyName: "Acme Freight",
  whatYouSell: "Route optimization software for freight carriers.",
  websiteUrl: null,
};

/** A well-formed model draft that should map to a schema-valid config. */
const GOOD_JSON = JSON.stringify({
  business: {
    oneLiner: "We help freight carriers cut fuel spend.",
    whatYouSell: "Route optimization software for freight carriers.",
    icp: "Mid-market freight carriers running 50 to 500 trucks.",
    decisionMakerRoles: ["VP of Operations", "Fleet Manager", "COO"],
    geography: "United States and Canada",
  },
  signals: [
    {
      name: "Fleet expansion",
      kind: "fleet_expansion",
      why: "New trucks mean new routes to plan.",
      dataSource: "DOT filings and hiring posts",
      freshnessDays: 45,
    },
    {
      name: "Fuel price spike",
      kind: "fuel_spike",
      why: "Rising fuel makes efficiency urgent.",
      dataSource: "EIA fuel index",
      freshnessDays: 14,
    },
    {
      name: "New ops leader",
      kind: "leadership_change",
      why: "A new VP wants an early win.",
      dataSource: "LinkedIn announcements",
      freshnessDays: 90,
    },
  ],
  pitch: {
    painFit: "Dispatchers plan routes by hand and burn fuel on backtracking.",
    opener: {
      leadWith: "Open on their recent fleet growth.",
      vocabulary: ["dispatch", "backhaul", "fuel spend"],
      tone: "Direct and operational.",
      exampleOpener: "Saw you added trucks this quarter, which usually strains dispatch.",
    },
    discoveryQuestions: ["How do you plan routes today?", "What does a bad routing day cost you?"],
    objections: [
      { q: "We already use a TMS.", rebuttal: "Great, this layers on top and optimizes the routes it assigns." },
    ],
  },
  proof: [
    {
      claim: "A regional carrier cut fuel spend",
      metric: "12% lower fuel cost in 90 days",
      sourceUrl: "https://example.com/case-study",
    },
    { claim: "Pilot results pending", metric: "", sourceUrl: "" },
  ],
  brand: {
    productName: "RouteWise",
    primaryColor: "#0d6efd",
    accentColor: "#20c997",
    heroFrom: "#0a4bb3",
    heroTo: "#7cc0ff",
    logoText: "RouteWise",
  },
});

describe("generateDraftConfig", () => {
  it("returns source 'ai' and a schema-valid config for well-formed model output", async () => {
    const result = await generateDraftConfig(INPUT, FakeAdaptClient.fromText(GOOD_JSON));

    expect(result.source).toBe("ai");
    expect(DraftWorkspaceConfigSchema.safeParse(result.config).success).toBe(true);
    // Company name is echoed from the trusted input, never the model.
    expect(result.config.brand.companyName).toBe("Acme Freight");
    expect(result.config.brand.primaryColor).toBe("#0d6efd");
    expect(result.config.signals).toHaveLength(3);
  });

  it("resolves the proof union: a metric + URL is real, an empty one is pending", async () => {
    const result = await generateDraftConfig(INPUT, FakeAdaptClient.fromText(GOOD_JSON));
    expect(result.config.proof).toHaveLength(2);
    expect(result.config.proof[0]).toMatchObject({
      metric: "12% lower fuel cost in 90 days",
      sourceUrl: "https://example.com/case-study",
    });
    expect(result.config.proof[1]).toMatchObject({ tag: "pending" });
  });

  it("falls back to a schema-valid config on empty model output", async () => {
    const result = await generateDraftConfig(INPUT, FakeAdaptClient.empty());
    expect(result.source).toBe("fallback");
    expect(DraftWorkspaceConfigSchema.safeParse(result.config).success).toBe(true);
    expect(result.config.brand.companyName).toBe("Acme Freight");
    expect(result.config.signals.length).toBeGreaterThanOrEqual(1);
  });

  it("falls back on malformed JSON", async () => {
    const result = await generateDraftConfig(INPUT, FakeAdaptClient.malformed());
    expect(result.source).toBe("fallback");
    expect(DraftWorkspaceConfigSchema.safeParse(result.config).success).toBe(true);
  });

  it("falls back when the client throws (network / non-2xx)", async () => {
    const result = await generateDraftConfig(INPUT, FakeAdaptClient.throwing());
    expect(result.source).toBe("fallback");
    expect(DraftWorkspaceConfigSchema.safeParse(result.config).success).toBe(true);
  });

  it("falls back when the model returns an invalid brand color", async () => {
    // Structured outputs guarantee shape, not that a string is a #rrggbb hex.
    const bad = JSON.parse(GOOD_JSON);
    bad.brand.primaryColor = "#fff"; // shorthand — rejected by WorkspaceConfigSchema
    const result = await generateDraftConfig(INPUT, FakeAdaptClient.fromText(JSON.stringify(bad)));
    expect(result.source).toBe("fallback");
    expect(DraftWorkspaceConfigSchema.safeParse(result.config).success).toBe(true);
  });

  it("derives the fallback palette from the company name, not EliseAI purple", async () => {
    const result = await generateDraftConfig(INPUT, FakeAdaptClient.empty());
    expect(result.config.brand.primaryColor).not.toBe("#7638fa");
  });
});
