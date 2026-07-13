import { describe, expect, it } from "vitest";
import {
  CONNECTIONS,
  describeLeadValue,
  deriveConnectionStatus,
  deriveGoLive,
  firstBriefHref,
} from "@/src/connect/connections";
import { KEY_SETUPS, SEQUENCE_SETUP } from "@/src/connect/setup-prompts";
import { HUBSPOT_SEQUENCE_PROMPT } from "@/src/connect/sequence-setup-prompt";
import {
  SEND_TOUCH_COUNT,
  bodyPropertyPayload,
  subjectPropertyPayload,
} from "@/src/send/hubspot-send";

/** Every icon the checklist uses must be a real StepIcon glyph (guards typos). */
const STEP_ICON_KEYS = [
  "rank",
  "tap",
  "spark",
  "proof",
  "pencil",
  "thumb",
  "prep",
  "tools",
  "fit",
  "ask",
  "search",
  "key",
];

const KEYS_SET = { anthropic: true, pdl: true };
const KEYS_UNSET = { anthropic: false, pdl: false };

/**
 * Thread 08 — RevOps onboarding. The Connections surface's pure logic is unit-
 * tested here (the repo has no component-render infra); the visual/interaction
 * pieces are verified by rendering /styleguide/integrations.
 *
 * This file grows with the units: U1 (opener numbers) first, then the checklist
 * status/go-live derivation and the ENGINE_KEYS↔KEY_SETUPS URL guard.
 */

describe("firstBriefHref (U1)", () => {
  it("points at the first feed row's real practice route", () => {
    expect(firstBriefHref([{ id: "prac_abc" }, { id: "prac_def" }])).toBe(
      "/practice/prac_abc",
    );
  });

  it("returns null for an empty feed so the opener degrades to the feed link", () => {
    expect(firstBriefHref([])).toBeNull();
  });
});

describe("describeLeadValue (U1)", () => {
  it("frames a real count with a plural noun phrase", () => {
    expect(describeLeadValue(12)).toEqual({
      hasLeads: true,
      count: 12,
      phrase: "12 hot leads",
    });
  });

  it("uses the singular for exactly one lead", () => {
    expect(describeLeadValue(1)).toEqual({
      hasLeads: true,
      count: 1,
      phrase: "1 hot lead",
    });
  });

  it("returns the honest no-number state for zero (never a fake tally)", () => {
    expect(describeLeadValue(0)).toEqual({
      hasLeads: false,
      count: 0,
      phrase: "",
    });
  });

  it("defends against NaN / negative counts", () => {
    expect(describeLeadValue(Number.NaN).hasLeads).toBe(false);
    expect(describeLeadValue(-3).hasLeads).toBe(false);
  });
});

describe("deriveConnectionStatus (U3)", () => {
  it("HubSpot reads connected on an OAuth grant (sequence handled separately)", () => {
    expect(
      deriveConnectionStatus("hubspot", {
        hubspot: { state: "connected", sequenceId: null },
        engineKeys: KEYS_UNSET,
      }),
    ).toBe("connected");
    expect(
      deriveConnectionStatus("hubspot", {
        hubspot: { state: "disconnected" },
        engineKeys: KEYS_SET,
      }),
    ).toBe("not_yet");
  });

  it("an engine key reads connected only when its key is present", () => {
    const hubspot = { state: "disconnected" } as const;
    expect(
      deriveConnectionStatus("anthropic", {
        hubspot,
        engineKeys: { anthropic: true, pdl: false },
      }),
    ).toBe("connected");
    expect(
      deriveConnectionStatus("pdl", {
        hubspot,
        engineKeys: { anthropic: true, pdl: false },
      }),
    ).toBe("not_yet");
  });
});

describe("deriveGoLive (U3)", () => {
  it("is live only when connected AND a sequence id is set", () => {
    expect(deriveGoLive({ state: "connected", sequenceId: "712515259" })).toEqual({
      live: true,
      sequencePending: false,
      disconnected: false,
    });
  });

  it("flags the sequence as the last step when connected without one", () => {
    expect(deriveGoLive({ state: "connected", sequenceId: null })).toEqual({
      live: false,
      sequencePending: true,
      disconnected: false,
    });
    // an empty string is not a real sequence id
    expect(deriveGoLive({ state: "connected", sequenceId: "" }).live).toBe(false);
  });

  it("flags disconnected before anything else", () => {
    expect(deriveGoLive({ state: "disconnected" })).toEqual({
      live: false,
      sequencePending: false,
      disconnected: true,
    });
  });
});

describe("CONNECTIONS meta (U3)", () => {
  it("orders hubspot, anthropic, pdl and marks only hubspot required", () => {
    expect(CONNECTIONS.map((c) => c.id)).toEqual(["hubspot", "anthropic", "pdl"]);
    const required = CONNECTIONS.filter((c) => c.required).map((c) => c.id);
    expect(required).toEqual(["hubspot"]);
  });

  it("uses only real StepIcon glyphs", () => {
    for (const c of CONNECTIONS) {
      expect(STEP_ICON_KEYS).toContain(c.icon);
    }
  });
});

describe("SEQUENCE_SETUP prompt (U5)", () => {
  it("is the verbatim handoff prompt (never retyped)", () => {
    expect(SEQUENCE_SETUP.chromePrompt).toBe(HUBSPOT_SEQUENCE_PROMPT);
  });

  it("keeps the load-bearing zero-paste + D9 lines intact", () => {
    const p = SEQUENCE_SETUP.chromePrompt;
    // STEP D closes the loop (agent saves the id back into GTM Maestro).
    expect(p).toContain('click "Save sequence ID"');
    expect(p).toContain('the badge flips to "Set"');
    // D9: the agent must stop before any send.
    expect(p).toContain("STOP before anything that would send");
  });

  it("keeps STEP A as verify-and-complete (a stale portal can be missing properties)", () => {
    // The app auto-provisions at connect, but a portal connected before per-touch
    // copy / the contacts-schema scope shipped can be missing some — a real run
    // (2026-07-13) found only 2 of 6. So the prompt must still walk the agent
    // through creating any that are missing, keyed by the exact internal names.
    const p = SEQUENCE_SETUP.chromePrompt;
    expect(p).toContain("Create property");
    expect(p).toContain("gtm_maestro_custom_subject_3");
    expect(p).toContain("gtm_maestro_custom_body_3");
  });

  it("every token the prompt names is the exact LABEL the app provisions", () => {
    // The agent picks each personalization token by its property label. If the
    // provisioned label (hubspot-send.ts) and the token name in the prompt drift
    // apart, the agent inserts nothing — so pin every one to the prompt verbatim.
    const p = SEQUENCE_SETUP.chromePrompt;
    for (let touch = 1; touch <= SEND_TOUCH_COUNT; touch++) {
      // Quote the token so touch 1 ("…Custom Subject") can't false-pass on the
      // touch-2 line ("…Custom Subject 2"); the prompt wraps every token in quotes.
      expect(p).toContain(`"${subjectPropertyPayload(touch).label}"`);
      expect(p).toContain(`"${bodyPropertyPayload(touch).label}"`);
    }
  });
});

describe("KEY_SETUPS verified key URLs (U4)", () => {
  // The engine-key field links (ENGINE_KEYS.href) are sourced from these, so a
  // stale URL here is the drift the field fix was about. Verified 2026-07-10.
  it("anthropic points at the current console keys page (not the redirect)", () => {
    expect(KEY_SETUPS.anthropic.keyUrl).toBe(
      "https://platform.claude.com/settings/keys",
    );
  });

  it("pdl points at the dashboard home (not the 401 api-keys endpoint)", () => {
    expect(KEY_SETUPS.pdl.keyUrl).toBe("https://dashboard.peopledatalabs.com");
  });
});
