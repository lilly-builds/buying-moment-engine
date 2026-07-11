import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../setup";
import { finalizeWorkspace, generateSampleFeed } from "@/src/adapt/finalize";
import {
  DraftWorkspaceConfigSchema,
  SampleFeedSchema,
  type DraftWorkspaceConfig,
} from "@/src/adapt/schema";
import { ELISEAI_DEFAULT } from "@/src/workspace/default";
import { getWorkspaceBySlug } from "@/src/workspace/store";
import { FakeAdaptClient } from "./doubles";

/**
 * A valid draft: the EliseAI default parsed through the draft schema, which
 * strips `sampleFeed` (the omitted key) — no unused destructure binding.
 */
const draft: DraftWorkspaceConfig = DraftWorkspaceConfigSchema.parse(ELISEAI_DEFAULT);

function feedProspect(i: number) {
  return {
    name: `Prospect ${i}`,
    oneLine: "A company that matches the ideal customer profile.",
    headline: "Just hit a buying moment worth a call.",
    freshnessLabel: "2 days ago",
    signals: [{ name: draft.signals[0].name, kind: draft.signals[0].kind }],
    brief: {
      whoToContact: {
        name: `Contact ${i}`,
        role: draft.business.decisionMakerRoles[0],
        channel: "Email",
        personalization: "Open on the buying moment you spotted.",
      },
      recommendedAction: "Send a short, specific note today.",
      painFit: "They feel the pain right now as the old way strains.",
      proofLine: "Early customers see the value once the timing is right.",
      discoveryQuestions: ["How are you handling this today?", "What changed recently?"],
      objections: [{ q: "Now is not a great time.", rebuttal: "Fair, and that is usually when it costs most." }],
    },
  };
}

const GOOD_FEED = JSON.stringify({
  prospects: [feedProspect(1), feedProspect(2), feedProspect(3)],
});

describe("generateSampleFeed", () => {
  it("returns exactly 3 schema-valid prospects for well-formed model output", async () => {
    const feed = await generateSampleFeed(draft, FakeAdaptClient.fromText(GOOD_FEED));
    expect(feed).toHaveLength(3);
    expect(SampleFeedSchema.safeParse(feed).success).toBe(true);
    // Ids are assigned in code, never trusted from the model.
    expect(feed.map((p) => p.id)).toEqual(["sample-1", "sample-2", "sample-3"]);
  });

  it("falls back to a deterministic 3-item feed on bad model output", async () => {
    for (const client of [FakeAdaptClient.empty(), FakeAdaptClient.malformed(), FakeAdaptClient.throwing()]) {
      const feed = await generateSampleFeed(draft, client);
      expect(feed).toHaveLength(3);
      expect(SampleFeedSchema.safeParse(feed).success).toBe(true);
    }
  });

  it("falls back when the model returns a short (under 3) but otherwise valid feed", async () => {
    const shortFeed = JSON.stringify({ prospects: [feedProspect(1), feedProspect(2)] });
    const feed = await generateSampleFeed(draft, FakeAdaptClient.fromText(shortFeed));
    // The two-item feed is schema-valid on its own, but the "exactly 3" contract
    // sends it to the deterministic fallback instead.
    expect(feed).toHaveLength(3);
    expect(feed[0].name).toBe("Northwind Trading Co."); // a fallback name, not "Prospect 1"
  });
});

describe("finalizeWorkspace", () => {
  let t: TestDb;
  beforeEach(async () => {
    t = await createTestDb();
  });
  afterEach(async () => {
    await t.close();
  });

  it("persists the full workspace with a sample feed and sets it active", async () => {
    const activated: string[] = [];
    const result = await finalizeWorkspace(draft, {
      client: FakeAdaptClient.fromText(GOOD_FEED),
      db: t.db,
      setActive: async (slug) => void activated.push(slug),
    });

    expect(result.slug).toBe("eliseai"); // slugified from companyName "EliseAI"

    const stored = await getWorkspaceBySlug(result.slug, t.db);
    expect(stored).not.toBeNull();
    expect(stored?.config.sampleFeed).toHaveLength(3);
    expect(stored?.name).toBe(draft.brand.companyName);

    // The cookie writer was called with the persisted slug.
    expect(activated).toEqual([result.slug]);
  });

  it("still persists (with the fallback feed) when the model fails", async () => {
    const activated: string[] = [];
    const result = await finalizeWorkspace(draft, {
      client: FakeAdaptClient.throwing(),
      db: t.db,
      setActive: async (slug) => void activated.push(slug),
    });

    const stored = await getWorkspaceBySlug(result.slug, t.db);
    expect(stored?.config.sampleFeed).toHaveLength(3);
    expect(activated).toEqual([result.slug]);
  });
});
