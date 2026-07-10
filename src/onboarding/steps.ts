/**
 * src/onboarding/steps.ts — the guided "work your first lead" mini-mission (U17).
 *
 * The tour is DATA, not layout. Every step below maps 1:1 to the design:
 *   - `onboarding-design.md` §6 (the push 1–6 / pull 7 mini-mission), and
 *   - the "guided-step card — UI direction" per-step table (bold word · orb icon · chip).
 *
 * The `StepCard` component renders whatever this file says, so copy, icons, and
 * chips swap here without ever touching the card layout. One place to edit the words.
 *
 * WHY a builder (not a bare const): the Send step's bold word is the RevOps owner's
 * first name — a per-org config value (`src/target/config.ts`), never a hardcoded
 * "Kyle". So the steps are built from the resolved owner.
 *
 * PAGE + TARGET: the feed (`/`) and the brief (`/practice/[id]`) are separate routes,
 * so each step declares which `page` it lives on and the `target` element it
 * spotlights (a `data-tour="…"` hook on the real UI). The tour controller walks the
 * journey across both pages, persisting progress in localStorage.
 */

/** The orb icon for a step — drawn by `StepIcon` (design/components/onboarding). */
export type StepIconKey =
  | "rank" // ranked-list / flame — the feed, hottest on top
  | "tap" // cursor / tap — open a lead
  | "spark" // spark / bolt — why now
  | "proof" // link / magnifier — see the source
  | "pencil" // pencil — edit the email
  | "thumb" // 👍 — teach the tool
  | "prep" // call-prep sheet — the prep-for-call tab
  | "tools" // stacked layers — the prospect's current tech stack
  | "fit" // target — why the offer hits the mark
  | "ask" // speech bubble — the discovery questions to ask
  | "search" // search / plus — bring your own lead (pull)
  | "key"; // key / plug — the send handoff

/** Which real screen the step spotlights. */
export type StepPage = "feed" | "brief";

/**
 * How the learner ADVANCES from a step — "play it to learn it", not passive tooltips.
 *  - "engage": clicking the spotlighted element itself advances (and, for a link,
 *    also does its real thing — e.g. tapping a lead opens its brief).
 *  - "next": there's nothing to click through; the quiet "Next →" advances.
 * Every card also carries "Next →" as a reliable fallback, and a persistent "Skip".
 */
export type StepAdvance = "engage" | "next";

export interface OnboardingStep {
  /** Stable id — also the getting-started progress key. */
  id: string;
  /** 1-based position shown in the progress dots. */
  order: number;
  page: StepPage;
  /** `data-tour` value of the real element this step spotlights. */
  target: string;
  icon: StepIconKey;
  advance: StepAdvance;
  /** The one-instruction line as segments, so any key part(s) carry the bold weight. */
  line: { text: string; bold?: boolean }[];
  /**
   * Optional supporting sentence under the instruction — where a step needs to
   * make its VALUE obvious (why this lead is different, what the brief gives you).
   * Segments so a word or two can be italicised (`em`) or bolded (`bold`).
   */
  detail?: { text: string; em?: boolean; bold?: boolean }[];
  /** The ✦ context chip label (the design's "✦ Your feed" etc.). */
  chip: string;
  /**
   * For brief steps: which tier the brief must show for this step's target to be
   * on screen. The proof underlines live in call-prep; the editable email +
   * thumb + send live in outreach. The controller flips the brief to this tier
   * before spotlighting, so the coach-through lands on the right element.
   */
  briefMode?: "outreach" | "prep";
  /**
   * When advancing requires leaving this page, where "Next →" should go. The
   * controller resolves `"first-brief"` to the first lead's real href at runtime
   * (so it never hardcodes an id); `"feed"` returns to the feed.
   */
  nextHref?: "first-brief" | "feed";
}

/**
 * Build the mini-mission for a given RevOps owner.
 *
 * Journey order (grouped so the brief only switches tab once): feed 1–2 (hottest →
 * open the brief) → brief outreach 3–5 (why now → edit + send → score) → brief call
 * prep 6–9 (open the tab, then walk each real section: current tools → why we fit →
 * questions to ask). Every prep step spotlights the actual section and says what it
 * shows. Sending is folded into the edit step ("Edit anything. Send easily.").
 */
export function buildOnboardingSteps(): OnboardingStep[] {
  return [
    {
      id: "feed-hottest",
      order: 1,
      page: "feed",
      target: "feed-top",
      icon: "rank",
      advance: "next",
      line: [
        { text: "Your " },
        { text: "hottest leads", bold: true },
        { text: " are " },
        { text: "up top", bold: true },
        { text: "." },
      ],
      // The differentiation — why this beats a cold list — lives here, where a new
      // AE will actually read it.
      detail: [
        { text: "It's not just about " },
        { text: "who", em: true },
        { text: " buys. It's about " },
        { text: "when they buy", bold: true },
        {
          text: ". These prospects are in their buying moment right now, like a new hire, bad reviews, or an acquisition.",
        },
      ],
      chip: "Your feed",
    },
    {
      id: "feed-open",
      order: 2,
      page: "feed",
      target: "open-brief",
      icon: "tap",
      advance: "engage",
      line: [
        { text: "Your " },
        { text: "sales prep brief", bold: true },
        { text: " is " },
        { text: "ready", bold: true },
        { text: " for you." },
      ],
      detail: [
        {
          text: "“View brief” gives you the research on this prospect. You'll see the software they use now, plus the buying signals GTM Maestro found.",
        },
      ],
      chip: "Prep brief",
      nextHref: "first-brief",
    },
    {
      id: "brief-why",
      order: 3,
      page: "brief",
      target: "why-now",
      icon: "spark",
      advance: "next",
      // Name the concept — a new AE doesn't know "buying moment" yet unless we say it.
      line: [
        { text: "This is their " },
        { text: "buying moment", bold: true },
        { text: ". It's why they're ready now." },
      ],
      chip: "The brief",
    },
    {
      id: "brief-edit",
      order: 4,
      page: "brief",
      target: "edit-email",
      icon: "pencil",
      advance: "next",
      briefMode: "outreach",
      line: [
        { text: "Your " },
        { text: "email's ready", bold: true },
        { text: ". Edit anything. Send easily." },
      ],
      chip: "Make it yours",
    },
    {
      id: "brief-thumb",
      order: 5,
      page: "brief",
      target: "rate-lead",
      icon: "thumb",
      advance: "engage",
      briefMode: "outreach",
      line: [{ text: "Score it", bold: true }, { text: " with a thumbs up." }],
      chip: "Teach it",
    },
    // The call-prep walkthrough: open the tab, then one step per real section, each
    // spotlighting that section with copy that matches what it shows.
    {
      id: "brief-prep",
      order: 6,
      page: "brief",
      target: "prep-toggle",
      icon: "prep",
      advance: "next",
      briefMode: "prep",
      line: [{ text: "Prep for call", bold: true }, { text: " has it all." }],
      detail: [{ text: "Everything you need before you dial is right here." }],
      chip: "Call prep",
    },
    {
      id: "brief-incumbent",
      order: 7,
      page: "brief",
      target: "incumbent-tooling",
      icon: "tools",
      advance: "next",
      briefMode: "prep",
      line: [{ text: "See their " }, { text: "current tools", bold: true }, { text: "." }],
      detail: [{ text: "The software they run now, so you know exactly what you're replacing." }],
      chip: "Their setup",
    },
    {
      id: "brief-whyfits",
      order: 8,
      page: "brief",
      target: "why-fits",
      icon: "fit",
      advance: "next",
      briefMode: "prep",
      line: [{ text: "Here's " }, { text: "why EliseAI fits", bold: true }, { text: "." }],
      detail: [{ text: "The pain, the proof, and the ROI, ready to quote on the call." }],
      chip: "Your pitch",
    },
    {
      id: "brief-discovery",
      order: 9,
      page: "brief",
      target: "discovery",
      icon: "ask",
      advance: "next",
      briefMode: "prep",
      line: [{ text: "The " }, { text: "questions", bold: true }, { text: " to dive deeper." }],
      detail: [
        { text: "The right questions get a prospect to sell themselves on your solution." },
      ],
      chip: "On the call",
    },
  ];
}

/** Total steps in the mini-mission (for progress copy / dots). */
export const ONBOARDING_STEP_COUNT = 9;
