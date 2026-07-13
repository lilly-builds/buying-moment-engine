/**
 * BYOK key-setup helpers (U17 follow-up). For each engine key we give the RevOps
 * lead TWO ways to get it, so a non-technical owner never has to dig through an
 * unfamiliar dashboard:
 *
 *  1. `chromePrompt` — paste into the Claude for Chrome extension. Claude GUIDES the
 *     user: it walks them to the exact page and names the exact buttons, but the user
 *     does every step that touches the key (create, copy, paste). Claude never
 *     creates, adds, saves, reads, copies, or types the key, because it is a secret.
 *     The prompt also documents the sign-in step (Claude can't log in for you).
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
  chromePrompt: `Help me create my own Anthropic (Claude) API key and paste it into GTM Maestro, using the Claude for Chrome extension. Your job is to GUIDE me: take me to the right page and tell me the exact buttons to click. For safety you never create, add, save, read, copy, or type the key. I do every step that touches the key myself, because an API key is a secret.

1. Open https://platform.claude.com/settings/keys in a new tab.
2. If a sign-in screen shows, tell me to sign in (email and password, or Google). You cannot sign in for me. Wait until I am on the "API keys" page, then continue.
3. Point me to the "Create key" button in the top right and tell me to click it.
4. In the "Create API key" box, tell me to leave Workspace on "Default", type the name gtm-maestro, leave "Expires" blank, and click "Add".
5. Tell me that the key now appears one time and starts with sk-ant-, and that I should copy it myself.
6. Take me back to the GTM Maestro Integrations page and tell me to paste my key into the Anthropic field and click Save. If GTM Maestro asks me to sign in first, tell me to sign in, then continue.

At no point do you read, copy, or type the key. Just tell me where to click. If you are ever unsure, stop and ask me.`,
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
  chromePrompt: `Help me get my People Data Labs (PDL) API key and paste it into GTM Maestro, using the Claude for Chrome extension. Your job is to GUIDE me: take me to the right page and tell me the exact spot to click. For safety you never read, copy, or type the key. I do every step that touches the key myself, because an API key is a secret.

1. Open https://dashboard.peopledatalabs.com in a new tab.
2. If it says "Verify Your Identity", PDL just emailed me a code. Tell me to check my email, type the code, and click Continue. You cannot enter my code. Wait until I am on the Home page, then continue.
3. Point me to the "My API Key" box near the top of the Home page.
4. Tell me to click the Copy button next to my key, and that I copy it myself. (If I would rather create a fresh key, tell me to click "Manage Keys" and make one there.)
5. Take me back to the GTM Maestro Integrations page and tell me to paste my key into the People Data Labs field and click Save. If GTM Maestro asks me to sign in first, tell me to sign in, then continue.

At no point do you read, copy, or type the key. Just tell me where to click. If you are ever unsure, stop and ask me.`,
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
 * no create/list-sequence endpoint). The RevOps leader pastes this prompt into the
 * Claude for Chrome extension; the agent verifies/creates the six contact properties
 * (STEP A — the app auto-provisions them at connect, but a stale portal can be
 * missing some, so the agent completes them), builds the dynamic sequence, AND
 * (hands-free, STEP D) writes the sequence ID back into GTM Maestro's "Sequence ID"
 * field, so the leader pastes nothing.
 *
 * SOURCE OF TRUTH: `sequence-setup-prompt.ts`. It mirrors
 * `onboarding/hubspot-setup-handoff.md` Path (2); keep the doc in sync when it
 * changes. The STEP D "read the ID → Save → VERIFY the badge" flow closes the
 * zero-paste loop; the "STOP before anything that would send" guardrail keeps D9;
 * the six token names must equal the property labels in `hubspot-send.ts`. All
 * three are guarded by `connections.test.ts`.
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
    "The GTM Maestro drafts a customized 3-part email sequence. It sends through a HubSpot email sequence, so your whole customer journey gets tracked in one hub. Use the Claude for Chrome prompt below to set up this email sequence agentically (yes, it sets up the full flow for you). P.S. it may take 5 to 10 minutes to set up, so you can leave Claude for Chrome running in the background.",
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
