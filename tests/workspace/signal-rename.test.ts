import { describe, expect, it } from "vitest";
import type { WorkspaceConfig } from "@/src/workspace/schema";
import {
  applySignalRenamesToSampleFeed,
  buildSignalRenameMap,
} from "@/src/workspace/signal-rename";

type Signal = WorkspaceConfig["signals"][number];
type SampleProspect = WorkspaceConfig["sampleFeed"][number];

function signal(name: string): Signal {
  return { name, kind: "custom", why: "why", dataSource: "Public sources", freshnessDays: 30 };
}

/** A prospect firing the given signal names (only name + kind matter here). */
function prospect(id: string, names: string[]): SampleProspect {
  return {
    id,
    name: `Prospect ${id}`,
    oneLine: "A company that matches the ideal customer profile.",
    headline: "Just hit a buying moment worth a call.",
    freshnessLabel: "2 days ago",
    signals: names.map((n) => ({ name: n, kind: "custom" })),
    brief: {
      whoToContact: { name: "Contact", role: "Head of Ops", channel: "Email", personalization: "Hello." },
      recommendedAction: "Send a short, specific note.",
      painFit: "The pain is real and the timing is right.",
      proofLine: "Early customers saw the value quickly.",
      discoveryQuestions: ["What changed recently?"],
      objections: [{ q: "Now is not a great time.", rebuttal: "That is usually when it costs the most." }],
    },
  };
}

describe("buildSignalRenameMap", () => {
  it("maps only the index whose name changed", () => {
    const initial = [signal("Hiring surge in job postings"), signal("New funding round")];
    const edited = [signal("Hiring surge across teams"), signal("New funding round")];
    const renames = buildSignalRenameMap(initial, edited);
    expect(renames.size).toBe(1);
    expect(renames.get("Hiring surge in job postings")).toBe("Hiring surge across teams");
    expect(renames.has("New funding round")).toBe(false);
  });

  it("ignores added, removed, and empty-name signals", () => {
    const initial = [signal("A"), signal("B")];
    const edited = [signal("A2"), signal(""), signal("C")]; // index 1 -> empty, index 2 added
    const renames = buildSignalRenameMap(initial, edited);
    expect(renames.size).toBe(1);
    expect(renames.get("A")).toBe("A2");
  });

  it("does NOT mistake a removal for a rename (index shift must not relabel)", () => {
    // Remove the first signal: every later name shifts up one index. A naive
    // index-diff would map Hiring->Funding and Funding->Leader and corrupt the feed.
    const initial = [signal("Hiring surge"), signal("New funding"), signal("New leader")];
    const edited = [signal("New funding"), signal("New leader")];
    const renames = buildSignalRenameMap(initial, edited);
    expect(renames.size).toBe(0);

    // And the feed is left completely untouched.
    const feed = [
      prospect("1", ["Hiring surge"]),
      prospect("2", ["New funding"]),
    ];
    const next = applySignalRenamesToSampleFeed(feed, renames);
    expect(next[0].signals[0].name).toBe("Hiring surge");
    expect(next[1].signals[0].name).toBe("New funding");
  });
});

describe("applySignalRenamesToSampleFeed", () => {
  it("renaming signal[0] updates matching feed labels and leaves others untouched", () => {
    const initial = [signal("Hiring surge in job postings"), signal("New funding round")];
    const edited = [signal("Hiring surge across teams"), signal("New funding round")];
    const feed = [
      prospect("1", ["Hiring surge in job postings"]),
      prospect("2", ["New funding round"]),
      prospect("3", ["Hiring surge in job postings", "New funding round"]),
    ];

    const renames = buildSignalRenameMap(initial, edited);
    const next = applySignalRenamesToSampleFeed(feed, renames);

    // Matching labels are rewritten to the new name.
    expect(next[0].signals[0].name).toBe("Hiring surge across teams");
    expect(next[2].signals[0].name).toBe("Hiring surge across teams");
    // Non-matching labels are untouched.
    expect(next[1].signals[0].name).toBe("New funding round");
    expect(next[2].signals[1].name).toBe("New funding round");
    // Immutable: the original feed is not mutated.
    expect(feed[0].signals[0].name).toBe("Hiring surge in job postings");
  });

  it("is a no-op when nothing was renamed", () => {
    const feed = [prospect("1", ["A"]), prospect("2", ["B"])];
    const next = applySignalRenamesToSampleFeed(feed, new Map());
    expect(next).toEqual(feed);
  });
});
