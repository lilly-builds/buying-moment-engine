/**
 * BYOK key-setup helpers (U17 follow-up). For each engine key we give the RevOps
 * lead TWO ways to get it, so a non-technical owner never has to dig through an
 * unfamiliar dashboard:
 *
 *  1. `chromePrompt` — paste into Claude Code + the Claude Chrome extension. Claude
 *     drives the dashboard right up to the key and PAUSES: the user does the final
 *     create/copy themselves, because an API key is a secret Claude must never read,
 *     copy, or type. The prompt also documents the sign-in step (Claude can't log in
 *     for you).
 *  2. `manualSteps` — the same path written out, for anyone who'd rather click it
 *     themselves.
 *
 * SINGLE SOURCE OF TRUTH: the Connections page renders these, and the RevOps guide
 * (`docs/revops-connections-guide.md`) mirrors them — so the copy never drifts.
 * Verified against the live dashboards on 2026-07-10.
 */

import { HUBSPOT_SEQUENCE_PROMPT } from "./sequence-setup-prompt";

export interface KeySetup {
  provider: "anthropic" | "pdl";
  /** The exact page to open — direct, no redirect. */
  keyUrl: string;
  /** One line naming the sign-in the user will hit (Claude can't do it for them). */
  signIn: string;
  /** The copy-paste Claude Chrome prompt. */
  chromePrompt: string;
  /** The do-it-yourself steps, one action per line. */
  manualSteps: string[];
}

export const ANTHROPIC_SETUP: KeySetup = {
  provider: "anthropic",
  keyUrl: "https://platform.claude.com/settings/keys",
  signIn: "You'll sign in to the Claude Console (email + password, or Google).",
  chromePrompt: `Help me get my Anthropic (Claude) API key for GTM Maestro, using the Claude Chrome extension. Do the steps below and STOP right before the key is created — an API key is a secret, so never read, copy, or type it; I'll do that part.

1. Open https://platform.claude.com/settings/keys in a new tab.
2. If a sign-in screen appears, PAUSE and tell me to sign in (I'll use email + password or Google). You can't log in for me. When I'm in, keep going.
3. On the "API keys" page, click "Create key" (top-right).
4. In the "Create API key" box: leave Workspace as "Default", and type the Name: gtm-maestro. Leave "Expires" blank.
5. STOP. Tell me exactly this: "Click Add, then copy the key that appears (it starts with sk-ant- and is shown only once) and paste it into GTM Maestro's Anthropic field." Do NOT click Add, and do NOT read or copy the key.`,
  manualSteps: [
    "Go to platform.claude.com/settings/keys (sign in if it asks).",
    'Click "Create key" (top-right).',
    'Name it gtm-maestro, leave Workspace on "Default", then click "Add".',
    "Copy the key that appears. It starts with sk-ant- and is shown only once.",
    "Paste it into the Anthropic field above.",
  ],
};

export const PDL_SETUP: KeySetup = {
  provider: "pdl",
  keyUrl: "https://dashboard.peopledatalabs.com",
  signIn:
    "PDL emails you a one-time code to sign in (it does not use a password).",
  chromePrompt: `Help me get my People Data Labs (PDL) API key for GTM Maestro, using the Claude Chrome extension. Do the steps below and STOP right before I copy the key — an API key is a secret, so never read, copy, or type it.

1. Open https://dashboard.peopledatalabs.com in a new tab.
2. If it says "Verify Your Identity", PDL just emailed me a code. PAUSE and tell me to check my email, type the code, and click Continue. You can't enter my code. When I'm in, keep going.
3. On the Home page, find the "My API Key" box near the top.
4. STOP. Tell me exactly this: "Click the Copy button next to 'My API Key', then paste it into GTM Maestro's People Data Labs field." Do NOT read or copy the key. (If I'd rather make a fresh key, tell me to click "Manage Keys" and create one there.)`,
  manualSteps: [
    "Go to dashboard.peopledatalabs.com (if it asks, enter the code PDL emails you and click Continue).",
    'On the Home page, find the "My API Key" box near the top.',
    'Click "Copy".',
    "Paste it into the People Data Labs field above.",
    '(Need a brand-new key? Click "Manage Keys" and create one.)',
  ],
};

export const KEY_SETUPS: Record<"anthropic" | "pdl", KeySetup> = {
  anthropic: ANTHROPIC_SETUP,
  pdl: PDL_SETUP,
};

/**
 * The HubSpot SEQUENCE setup — the one send step no API can automate (HubSpot has
 * no create/list-sequence endpoint). The RevOps leader hands this prompt to Claude
 * Code + the Claude Chrome extension; the agent builds the dynamic sequence in
 * their HubSpot AND (hands-free, STEP D) writes the sequence ID back into GTM
 * Maestro's "Sequence ID" field, so the leader pastes nothing.
 *
 * SINGLE SOURCE OF TRUTH: this is `onboarding/hubspot-setup-handoff.md` Path (2),
 * copied VERBATIM — the Connections page renders it and the doc mirrors it, so the
 * wording never drifts. The STEP D "read the ID → Save → VERIFY the badge" flow is
 * load-bearing (it closes the zero-paste loop); the "STOP before anything that
 * would send" guardrail is load-bearing (D9). Do NOT edit either.
 */
export interface SequenceSetup {
  /** One-line "what this does" for the card intro. */
  summary: string;
  /** The direct HubSpot Sequences page — where the sequence is built. */
  hubspotUrl: string;
  /** The copy-paste Claude Chrome prompt (verbatim, handoff Path 2). */
  chromePrompt: string;
  /** The setup videos, in order (handoff Path 3) — referenced, not served here. */
  videos: { file: string; label: string }[];
}

export const SEQUENCE_SETUP: SequenceSetup = {
  summary:
    "Build your send sequence once. Claude can do it for you, then fill the ID in here.",
  hubspotUrl: "https://app.hubspot.com/sequences",
  // Verbatim from the handoff doc (see `sequence-setup-prompt.ts` — never retyped).
  chromePrompt: HUBSPOT_SEQUENCE_PROMPT,
  videos: [
    { file: "hubspot-ui-setup-1.mov", label: "Where to start in HubSpot" },
    {
      file: "hubspot-custom-properties-subject-and-email-body2.mov",
      label: "The custom properties",
    },
    {
      file: "hubspot-custom-email-sequence-setup-3.mov",
      label: "Building the sequence",
    },
    { file: "hubspot-find-sequence-id-4.mov", label: "Finding the sequence ID" },
    { file: "hubspot-gmail-connect-5.mov", label: "Connecting the sending inbox" },
  ],
};
