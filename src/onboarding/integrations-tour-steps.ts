/**
 * src/onboarding/integrations-tour-steps.ts — the RevOps "connect your stack"
 * coach-through (Thread 08).
 *
 * The RevOps leader is walked through the REAL product exactly the way an AE is
 * (see `steps.ts`): every step dims the page and spotlights one real element. The
 * difference is the journey — a RevOps leader needs to SEE the value before the
 * connect ask, then land on the three connections that turn it on:
 *
 *   feed 1–2  (prospects ready to buy → open the brief)
 *   brief 3–6 (why now → the written email → the call brief → the payoff)
 *   integrations 7–9 (connect HubSpot → Anthropic → People Data Labs)
 *
 * The copy here is the locked value pitch, SPLIT across the walk so each claim is
 * spoken at the moment the real thing it describes lights up ("show, don't tell").
 * Steps 1–6 reuse the feed/brief `data-tour` hooks the AE tour already placed;
 * steps 7–9 use new hooks on the connection rows.
 *
 * Pure data — the controller (`app/onboarding/revops-tour.tsx`) renders it.
 */

import type { StepIconKey } from "@/src/onboarding/steps";

/** Which real screen the step spotlights (the controller maps URLs → these). */
export type RevopsTourPage = "feed" | "brief" | "integrations";

/**
 * Where "Next →" (or clicking the spotlit element) should navigate when the step
 * ends on a different page. `first-brief` resolves to the first lead's real brief
 * at runtime (never a hardcoded id); `integrations` goes to the connections page.
 */
export type RevopsNav = "first-brief" | "integrations";

export interface RevopsTourStep {
  /** Stable id (also the progress key). */
  id: string;
  /** 1-based position shown in the progress dots. */
  order: number;
  page: RevopsTourPage;
  /** `data-tour` value of the real element to spotlight, or null for a centred card. */
  target: string | null;
  icon: StepIconKey;
  /**
   * For brief steps: flip the brief to the tier that holds this step's target
   * before spotlighting (mirrors the AE tour — the editable email lives in
   * outreach, the call-prep sections in prep). A one-way `bme:brief-mode` event.
   */
  briefMode?: "outreach" | "prep";
  /** Cross-page destination for advancing off this page. */
  nav?: RevopsNav;
  /** The one-instruction line as segments — the key part(s) carry the bold weight. */
  line: { text: string; bold?: boolean }[];
  /** Optional supporting sentence under the instruction (a word or two can be em/bold). */
  detail?: { text: string; em?: boolean; bold?: boolean }[];
  /** The ✦ context chip label. */
  chip: string;
}

export const REVOPS_TOUR_STEPS: RevopsTourStep[] = [
  // ── Feed: the value they can already see ───────────────────────────────────
  {
    id: "feed-ready-to-buy",
    order: 1,
    page: "feed",
    target: "feed-top",
    icon: "rank",
    line: [
      { text: "These are prospects " },
      { text: "ready to buy right now", bold: true },
      { text: "." },
    ],
    detail: [
      {
        text: "Not who fits your market like Clay, Apollo, or ZoomInfo. Who's ready today, from real timing-based signals: a front-desk hiring spree, patient reviews about long hold times and calls that go unanswered, a new location opening.",
      },
    ],
    chip: "Your live feed",
  },
  {
    id: "feed-open-brief",
    order: 2,
    page: "feed",
    target: "open-brief",
    icon: "tap",
    nav: "first-brief",
    line: [
      { text: "Each one comes " },
      { text: "done for the rep", bold: true },
      { text: ". Open the brief." },
    ],
    detail: [
      { text: "The research, the outreach, and the call brief are already written." },
    ],
    chip: "The brief",
  },
  // ── Brief: what "done" actually means ──────────────────────────────────────
  {
    id: "brief-why-now",
    order: 3,
    page: "brief",
    target: "why-now",
    icon: "spark",
    line: [
      { text: "Here's their " },
      { text: "buying moment", bold: true },
      { text: ". It's why they're ready now." },
    ],
    detail: [{ text: "The timing signal that fired, cited to its source." }],
    chip: "Why now",
  },
  {
    id: "brief-email",
    order: 4,
    page: "brief",
    target: "edit-email",
    icon: "pencil",
    briefMode: "outreach",
    line: [
      { text: "The " },
      { text: "email is already written", bold: true },
      { text: "." },
    ],
    detail: [
      {
        text: "A ready-to-send 3-email sequence to the decision-maker's verified address, editable in a click.",
      },
    ],
    chip: "Ready to send",
  },
  {
    id: "brief-call-brief",
    order: 5,
    page: "brief",
    target: "incumbent-tooling",
    icon: "prep",
    briefMode: "prep",
    line: [
      { text: "And a full " },
      { text: "call brief", bold: true },
      { text: "." },
    ],
    detail: [
      { text: "The tools they run today, why EliseAI fits, and the questions to ask on the call." },
    ],
    chip: "Call brief",
  },
  {
    id: "brief-payoff",
    order: 6,
    page: "brief",
    target: null,
    icon: "thumb",
    nav: "integrations",
    line: [
      { text: "Your reps " },
      { text: "save an hour of research", bold: true },
      { text: " per lead." },
    ],
    detail: [
      {
        text: "They spend their time selling, and they reach prospects the moment they're most likely to say yes.",
      },
    ],
    chip: "The payoff",
  },
  // ── Integrations: the three connections that turn it on ────────────────────
  {
    id: "connect-hubspot",
    order: 7,
    page: "integrations",
    target: "connect-hubspot",
    icon: "key",
    line: [
      { text: "To go live, connect " },
      { text: "HubSpot", bold: true },
      { text: "." },
    ],
    detail: [
      {
        text: "It sends every email from your team's own inbox, and tracks each lead, meeting, and deal in your CRM.",
      },
    ],
    chip: "Go live",
  },
  {
    id: "connect-anthropic",
    order: 8,
    page: "integrations",
    target: "key-anthropic",
    icon: "spark",
    line: [
      { text: "Connect " },
      { text: "Anthropic", bold: true },
      { text: "." },
    ],
    detail: [{ text: "It researches each prospect and writes the brief." }],
    chip: "Research + writing",
  },
  {
    id: "connect-pdl",
    order: 9,
    page: "integrations",
    target: "key-pdl",
    icon: "search",
    line: [
      { text: "Connect " },
      { text: "People Data Labs", bold: true },
      { text: "." },
    ],
    detail: [
      {
        text: "It finds the decision-maker's verified email and LinkedIn, at lower cost than Clay or Apollo.",
      },
    ],
    chip: "Contact details",
  },
];

/** Total steps in the RevOps mini-mission (for progress dots). */
export const REVOPS_TOUR_STEP_COUNT = REVOPS_TOUR_STEPS.length;
