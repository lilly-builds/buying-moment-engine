/**
 * src/onboarding/integrations-tour-steps.ts — the RevOps "connect your stack"
 * coach-through (Thread 08).
 *
 * The RevOps leader is walked through the REAL product exactly the way an AE is
 * (see `steps.ts`): every step dims the page and spotlights one real element. The
 * difference is the journey — a RevOps leader needs to SEE the value and the ROI
 * before the connect ask, then land on the three connections that turn it on:
 *
 *   feed 1–2        (prospects ready to buy → open the brief)
 *   brief 3–7       (why now → the written email → the call brief → the payoff →
 *                    where the ROI Scoreboard lives, before we jump to it)
 *   scoreboard 8    (preview the ROI they'll prove once live)
 *   integrations 9–12 (what you're connecting → HubSpot → Anthropic → People Data Labs)
 *
 * Every page change is a taught TRANSITION, never a hard jump: we spotlight the nav
 * button that takes us to the scoreboard BEFORE going there, and we frame all three
 * connections in one overview BEFORE spotlighting them one by one.
 *
 * The copy here is the locked value pitch, SPLIT across the walk so each claim is
 * spoken at the moment the real thing it describes lights up ("show, don't tell").
 * Steps 1–8 reuse the feed/brief/nav/scoreboard `data-tour` hooks; steps 10–12 use
 * the hooks on the connection rows.
 *
 * Pure data — the controller (`app/onboarding/revops-tour.tsx`) renders it.
 */

import type { StepIconKey } from "@/src/onboarding/steps";

/** Which real screen the step spotlights (the controller maps URLs → these). */
export type RevopsTourPage = "feed" | "brief" | "scoreboard" | "integrations";

/**
 * Where "Next →" (or engaging the spotlit element) navigates when the step ends on
 * a different page. `first-brief` resolves to the first lead's real brief at
 * runtime (never a hardcoded id); `scoreboard` / `integrations` go to those pages.
 */
export type RevopsNav = "first-brief" | "scoreboard" | "integrations";

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
  /**
   * True when the spotlit element is a control the learner clicks to proceed (the
   * "View brief" button). Clicking it then advances the tour AND navigates; on
   * content steps this stays false so a stray click never hijacks the tour.
   */
  engage?: boolean;
  /** The one-instruction line as segments — the key part(s) carry the bold weight. */
  line: { text: string; bold?: boolean }[];
  /** Optional supporting sentence under the instruction (a word or two can be em/bold). */
  detail?: { text: string; em?: boolean; bold?: boolean }[];
  /** For the connect-overview beat: a short framed list (label + value per row). */
  bullets?: { label: string; text: string }[];
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
      { text: "GTM Maestro finds prospects that are ready to buy right now", bold: true },
      { text: ", with the email already written and the call brief already prepped." },
    ],
    detail: [
      { text: "Clay, Apollo, and ZoomInfo find " },
      { text: "who", bold: true },
      { text: " fits your market. This finds " },
      { text: "who's ready to buy today", bold: true },
      { text: ", from " },
      { text: "real timing-based signals", bold: true },
      {
        text: ": a prospect on a front-desk hiring spree, patient reviews about long hold times and calls that go unanswered, a new location opening.",
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
    engage: true,
    line: [
      { text: "Open any prospect. The brief is " },
      { text: "already done", bold: true },
      { text: "." },
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
    detail: [
      {
        text: "It's what just happened with this prospect that makes them ready to buy. Tap any fact to see where it came from.",
      },
    ],
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
      { text: "email", bold: true },
      { text: " is already " },
      { text: "customized to the prospect", bold: true },
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
    // Focused on the "Prep for call" toggle (like the AE tour), which opens the brief.
    id: "brief-call-brief",
    order: 5,
    page: "brief",
    target: "prep-toggle",
    icon: "prep",
    briefMode: "prep",
    line: [
      { text: "Every prospect also gets a full " },
      { text: "call brief", bold: true },
      { text: "." },
    ],
    detail: [
      {
        text: "A rep immediately discovers the tools they run today, why EliseAI fits, and the questions to ask on the call.",
      },
    ],
    chip: "Call brief",
  },
  {
    id: "brief-payoff",
    order: 6,
    page: "brief",
    target: "why-fits",
    icon: "thumb",
    briefMode: "prep",
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
  // ── Transition: show WHERE the scoreboard lives before jumping to it ─────────
  {
    // Spotlights the "Scoreboard" button in the top nav (visible on the brief page
    // too), so the page change is taught, not a hard jump. Clicking it — or Next —
    // navigates to the scoreboard.
    id: "nav-scoreboard",
    order: 7,
    page: "brief",
    target: "nav-scoreboard",
    icon: "tap",
    nav: "scoreboard",
    engage: true,
    line: [
      { text: "Check the results on your " },
      { text: "ROI Scoreboard", bold: true },
      { text: "." },
    ],
    // Direction-neutral so it reads right in both navs (desktop top bar / mobile
    // bottom bar). On desktop the spotlight lands on the nav button; on mobile the
    // step drops its spotlight (the button sits behind the sheet) and Next opens it.
    detail: [{ text: "Let's open it." }],
    chip: "The results",
  },
  // ── Scoreboard: the ROI they'll prove once live (one beat, not a walkthrough) ─
  {
    id: "roi-scoreboard",
    order: 8,
    page: "scoreboard",
    target: "roi-scoreboard",
    icon: "rank",
    nav: "integrations",
    line: [
      { text: "This is where you'll " },
      { text: "see the return", bold: true },
      { text: "." },
    ],
    detail: [
      {
        text: "Once you're live, the ROI Scoreboard fills in with your real numbers: deals won, cost per meeting, and the hours your team got back.",
      },
    ],
    chip: "ROI Scoreboard",
  },
  // ── Integrations: frame the three connections, then turn them on one by one ──
  {
    // A centred overview (no spotlight) that frames all three connections BEFORE we
    // spotlight them individually — the transition onto the integrations page.
    id: "connect-overview",
    order: 9,
    page: "integrations",
    target: null,
    icon: "key",
    line: [
      { text: "To activate GTM Maestro's " },
      { text: "full value", bold: true },
      { text: ", connect:" },
    ],
    bullets: [
      {
        label: "HubSpot",
        text: "sends every email from your team's own inbox, and tracks each lead, meeting, and deal in your CRM",
      },
      {
        label: "Anthropic (Claude)",
        text: "researches each prospect and writes the brief",
      },
      {
        label: "People Data Labs",
        text: "finds the decision-maker's verified email and LinkedIn, at lower cost than Clay or Apollo",
      },
    ],
    chip: "3 connections",
  },
  {
    id: "connect-hubspot",
    order: 10,
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
    order: 11,
    page: "integrations",
    target: "key-anthropic",
    icon: "spark",
    line: [
      { text: "Connect " },
      { text: "Anthropic", bold: true },
      { text: "." },
    ],
    detail: [
      { text: "It applies Claude to research each prospect and write a call prep brief." },
    ],
    chip: "Research + writing",
  },
  {
    id: "connect-pdl",
    order: 12,
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
