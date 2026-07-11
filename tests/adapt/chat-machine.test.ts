import { describe, expect, it } from "vitest";
import { buildFallbackDraft } from "@/src/adapt/fallback";
import {
  chatReducer,
  initialState,
  type ChatAction,
  type ChatState,
  type Turn,
} from "@/src/adapt/chat/machine";
import { brandSwatches, colorName } from "@/src/adapt/chat/voice";

/**
 * The conversational-onboarding reducer is the flow's spine, so this proves the two
 * things it must never get wrong: the phase / reveal choreography stays in lockstep,
 * and every Adapter line the machine emits is free of the banned AI tells (the voice
 * is the whole point of the variant).
 */

const DRAFT = buildFallbackDraft({
  companyName: "Northwind Freight",
  whatYouSell: "route-planning software for mid-market freight carriers",
  websiteUrl: null,
});

/** Reduce a sequence of actions from a fresh initial state. */
function run(actions: ChatAction[]): ChatState {
  return actions.reduce(chatReducer, initialState());
}

const adapterText = (state: ChatState): string[] =>
  state.turns.filter((t: Turn) => t.role === "adapter").map((t) => t.text);

/** Case-insensitive substrings that must never appear in an Adapter line. */
const BANNED = [
  "let's dive",
  "let's explore",
  "let's take a look",
  "take a look",
  "great question",
  "absolutely",
  "i hope this helps",
  "let me know",
  "seamless",
  "robust",
  "leverage",
  "unlock",
  "unleash",
  "elevate",
  "empower",
  "streamline",
  "foster",
  "harness",
  "cutting-edge",
  "game-changer",
  "comprehensive",
  "delve",
  "embark",
  "it's worth noting",
  "in order to",
  "genuinely",
  "truly",
];

/** The full happy path, one action per beat, exactly as the client drives it. */
const HAPPY_PATH: ChatAction[] = [
  { type: "SUBMIT_INTRO", companyName: "Northwind Freight", whatYouSell: "route-planning software for mid-market freight carriers", websiteUrl: null },
  { type: "ADAPTER_SPEAK" },
  { type: "GENERATED", draft: DRAFT },
  { type: "ADAPTER_SPEAK" },
  { type: "CONFIRM_AUDIENCE" },
  { type: "ADAPTER_SPEAK" },
  { type: "CONFIRM_SIGNALS" },
  { type: "ADAPTER_SPEAK" },
  { type: "SUBMIT_PROOF", claim: "Cut a carrier's fuel spend 12% in 90 days" },
  { type: "ADAPTER_SPEAK" },
  { type: "CONFIRM_BRAND" },
  { type: "ADAPTER_SPEAK" },
  { type: "FINALIZED" },
  { type: "ADAPTER_SPEAK" },
];

describe("chatReducer choreography", () => {
  it("seeds two Adapter opener turns and no reveals", () => {
    const state = initialState();
    expect(state.phase).toBe("opening");
    expect(adapterText(state)).toHaveLength(2);
    expect(state.reveal).toEqual({
      audience: false,
      signals: false,
      proof: false,
      brand: false,
      feed: "hidden",
    });
  });

  it("walks phases and reveals in lockstep through the happy path", () => {
    const end = run(HAPPY_PATH);
    expect(end.phase).toBe("done");
    expect(end.reveal).toEqual({
      audience: true,
      signals: true,
      proof: true,
      brand: true,
      feed: "filled",
    });
    // The user typed exactly twice (intro + proof) plus three confirm chips.
    const userTurns = end.turns.filter((t) => t.role === "user");
    expect(userTurns).toHaveLength(5);
  });

  it("reveals each piece only when the Adapter speaks that phase, not before", () => {
    // Right after GENERATED (before the audience SPEAK), audience must still be hidden.
    const beforeSpeak = run(HAPPY_PATH.slice(0, 3));
    expect(beforeSpeak.phase).toBe("audience");
    expect(beforeSpeak.reveal.audience).toBe(false);
    const afterSpeak = chatReducer(beforeSpeak, { type: "ADAPTER_SPEAK" });
    expect(afterSpeak.reveal.audience).toBe(true);
  });

  it("ignores ADAPTER_SPEAK when no line is pending (no duplicate turns)", () => {
    const spoken = run(HAPPY_PATH.slice(0, 4)); // ...through the studying + audience lines
    const again = chatReducer(spoken, { type: "ADAPTER_SPEAK" });
    expect(again.turns).toHaveLength(spoken.turns.length);
    expect(again).toBe(spoken);
  });

  it("holds the edited ICP and the proof claim on the draft", () => {
    const edited = run([
      ...HAPPY_PATH.slice(0, 4),
      { type: "EDIT_AUDIENCE", icp: "Fleet ops leaders at 50-to-500-truck carriers." },
    ]);
    expect(edited.draft?.business.icp).toBe("Fleet ops leaders at 50-to-500-truck carriers.");
    const end = run(HAPPY_PATH);
    expect(end.draft?.proof).toEqual([
      { claim: "Cut a carrier's fuel spend 12% in 90 days", tag: "pending" },
    ]);
  });

  it("skips proof to an empty array without revealing a proof line", () => {
    const skipped = run([
      ...HAPPY_PATH.slice(0, 8),
      { type: "SKIP_PROOF" },
    ]);
    expect(skipped.phase).toBe("brand");
    expect(skipped.draft?.proof).toEqual([]);
    expect(skipped.reveal.proof).toBe(false);
  });

  it("re-skins the draft brand when a swatch is picked", () => {
    const swatches = brandSwatches(DRAFT);
    const alt = swatches[1];
    const picked = chatReducer(
      { ...run(HAPPY_PATH.slice(0, 12)) },
      { type: "PICK_COLOR", patch: alt.patch },
    );
    expect(picked.draft?.brand.primaryColor).toBe(alt.patch.primaryColor);
    expect(picked.draft?.brand.heroFrom).toBe(alt.patch.heroFrom);
  });

  it("recovers from a finalize error on retry", () => {
    const failed = chatReducer(run(HAPPY_PATH.slice(0, 12)), { type: "FINALIZE_ERROR" });
    expect(failed.finalizeError).toBe(true);
    const retry = chatReducer(failed, { type: "RETRY_FINALIZE" });
    expect(retry.finalizeError).toBe(false);
    expect(retry.finalizeNonce).toBe(failed.finalizeNonce + 1);
  });
});

describe("Adapter voice", () => {
  it("emits no banned AI tells and no em dashes across the whole flow", () => {
    const lines = adapterText(run(HAPPY_PATH));
    for (const line of lines) {
      expect(line.includes("—"), `em dash in: ${line}`).toBe(false);
      const lower = line.toLowerCase();
      for (const phrase of BANNED) {
        expect(lower.includes(phrase), `banned "${phrase}" in: ${line}`).toBe(false);
      }
    }
  });

  it("starts every Adapter line with a capital letter", () => {
    const lines = adapterText(run(HAPPY_PATH));
    for (const line of lines) {
      const first = line.trimStart()[0];
      expect(first === first.toUpperCase(), `not capitalized: ${line}`).toBe(true);
    }
  });

  it("names the brand color from its hex", () => {
    expect(colorName("#0d9488")).toBe("teal");
    expect(colorName("#4f46e5")).toBe("indigo");
    expect(colorName("#e11d48")).toBe("rose");
  });

  it("leads the swatches with the AI pick and dedupes alternates by hue", () => {
    const swatches = brandSwatches(DRAFT);
    expect(swatches[0].isPick).toBe(true);
    const names = swatches.map((s) => s.colorName);
    expect(new Set(names).size).toBe(names.length);
  });
});
