/**
 * src/connect/connections.ts — pure helpers behind the RevOps "Connections"
 * onboarding surface (U17 · Thread 08).
 *
 * Everything here is PURE (no React, no I/O) so the server page, the client
 * island, and Vitest can all import it — the value/status logic is unit-tested
 * without a browser (the repo has no component-render infra).
 *
 * Two concerns live here:
 *   1. The value-first opener's honest numbers (real hot-lead count → copy;
 *      the first live-brief link) — this file's first half.
 *   2. The connection checklist's data model + status/go-live derivation — added
 *      alongside the checklist UI (see `CONNECTIONS` below).
 */

import type { StepIconKey } from "@/src/onboarding/steps";

// ── Value-first opener helpers ────────────────────────────────────────────────

/**
 * The first live brief to open from the opener — the single most persuasive
 * artifact ("show, don't tell", onboarding-design §1). Takes the feed rows the
 * page already loads and points at the real practice route (`/practice/[id]`);
 * `null` when the feed is empty so the opener degrades to the feed link instead.
 * Structurally typed on `{ id }` so it never couples to the full `FeedRow`.
 */
export function firstBriefHref(rows: readonly { id: string }[]): string | null {
  const first = rows[0];
  return first ? `/practice/${first.id}` : null;
}

/** The opener's lead-value framing — the REAL number, never a fabricated one. */
export interface LeadValue {
  /** True when there's at least one real hot lead to headline. */
  hasLeads: boolean;
  /** The floored, non-negative count. */
  count: number;
  /** The noun phrase for the count ("12 hot leads" / "1 hot lead"); "" when none. */
  phrase: string;
}

/**
 * Describe the real hot-lead count for the opener. Zero/unknown → `hasLeads:
 * false` so the opener shows the honest no-number framing (never a fake tally,
 * per the ship-today decision + design §7). Guards NaN / negatives defensively.
 */
export function describeLeadValue(count: number): LeadValue {
  const n = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
  if (n === 0) return { hasLeads: false, count: 0, phrase: "" };
  return {
    hasLeads: true,
    count: n,
    phrase: `${n} hot ${n === 1 ? "lead" : "leads"}`,
  };
}

// ── The connections checklist (data model + status derivation) ────────────────

export type ConnectionId = "hubspot" | "anthropic" | "pdl";
export type ConnectionStatus = "connected" | "not_yet";

/** The live-status inputs the checklist reads. Structurally match the view's
 *  `HubSpotStatus` / `EngineKeyStatus` (kept here so this module stays pure and
 *  app-independent — the view passes its own compatible values). */
export type HubSpotConnState =
  | { state: "connected"; sequenceId: string | null }
  | { state: "disconnected" };
export interface EngineKeyState {
  anthropic: boolean;
  pdl: boolean;
}

export interface ConnectionMeta {
  id: ConnectionId;
  /** Orb icon (reuses the tour's `StepIcon` set). */
  icon: StepIconKey;
  /** The one-instruction line, two weights — the bold segment is the key word. */
  line: { text: string; bold?: boolean }[];
  /** The supporting sentence under the instruction (like StepCard's detail). */
  detail: string;
  /** The ✦ context chip. */
  chip: string;
  /** Required green for a first go-live. Only HubSpot flips the Send gate live. */
  required: boolean;
}

/**
 * The three connections, in checklist order (spec § Stack). HubSpot is the one
 * OAuth connect that flips sending live; Anthropic + PDL are the BYOK engine keys.
 * Data-driven the same way the tour's `steps.ts` is — copy/icons swap here.
 */
export const CONNECTIONS: ConnectionMeta[] = [
  {
    id: "hubspot",
    icon: "key",
    line: [
      { text: "Connect " },
      { text: "HubSpot", bold: true },
      { text: " to go live." },
    ],
    detail:
      "One connection turns on sending — through your team's own inbox — and tracks every lead in your CRM.",
    chip: "Go live",
    required: true,
  },
  {
    id: "anthropic",
    icon: "spark",
    line: [
      { text: "Add your " },
      { text: "Anthropic", bold: true },
      { text: " key." },
    ],
    detail: "Researches each practice and writes the brief.",
    chip: "Research + writing",
    required: false,
  },
  {
    id: "pdl",
    icon: "search",
    line: [
      { text: "Add your " },
      { text: "People Data Labs", bold: true },
      { text: " key." },
    ],
    detail: "Finds the decision-maker's verified email + LinkedIn.",
    chip: "Contact details",
    required: false,
  },
];

/**
 * The row-level status pill. HubSpot reads "connected" once the OAuth grant is
 * made (the sequence step is shown as a sub-step, and gated in `deriveGoLive`);
 * each engine key reads "connected" when its key is present (stored or env).
 */
export function deriveConnectionStatus(
  id: ConnectionId,
  ctx: { hubspot: HubSpotConnState; engineKeys: EngineKeyState },
): ConnectionStatus {
  if (id === "hubspot") {
    return ctx.hubspot.state === "connected" ? "connected" : "not_yet";
  }
  return ctx.engineKeys[id] ? "connected" : "not_yet";
}

export interface GoLiveState {
  /** Send + CRM tracking are actually on: connected AND a sequence id is set. */
  live: boolean;
  /** Connected, but the sequence id isn't set yet — the last step to go live. */
  sequencePending: boolean;
  /** HubSpot isn't connected yet. */
  disconnected: boolean;
}

/**
 * The honest go-live signal — keyed on the SAME condition that lights the brief's
 * Send button (`readConnectionSendConfig`): connected AND a non-empty sequence id.
 * So "You're live" in onboarding means the tool can genuinely send.
 */
export function deriveGoLive(hubspot: HubSpotConnState): GoLiveState {
  if (hubspot.state !== "connected") {
    return { live: false, sequencePending: false, disconnected: true };
  }
  const hasSequence = hubspot.sequenceId != null && hubspot.sequenceId !== "";
  return { live: hasSequence, sequencePending: !hasSequence, disconnected: false };
}
