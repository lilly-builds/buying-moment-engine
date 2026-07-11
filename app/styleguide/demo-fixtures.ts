/**
 * Design-review fixtures (U8 / U9 / U12).
 *
 * These are LAYOUT FIXTURES for the styleguide's full-page previews, never a claim
 * about a real practice. The live app reads from Postgres (R1/R7, D9); nothing here
 * does. The practice + contact names are invented placeholders; the proof point, EHR,
 * and ROI benchmark citations are the REAL, verified ones from the dermatology pack
 * (`src/packs/dermatology.ts`), so the D2 citation contract renders exactly as it will
 * in production. Swap the placeholders for real practices only through the database.
 *
 * `now` is passed in so freshness reads relative to render time and the clocks stay
 * honest across days, the same reason `app/page.tsx` computes age against a single
 * `now`.
 */

import type { FeedItem } from "../feed";
import type { RenderedBrief } from "@/src/brief/render";
import { BRIEF_SCHEMA_VERSION } from "@/src/brief/config";
import type { ScopeData, ScoreboardData } from "../scoreboard-view";

const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (now: Date, n: number) => new Date(now.getTime() - n * DAY_MS);
const daysAhead = (now: Date, n: number) => new Date(now.getTime() + n * DAY_MS);

// Stable evidence ids so voice fields can reference the same atoms the facts cite.
const EV = {
  staffing: "b1e4a2c0-1111-4a11-8a11-0000000000a1",
  reviews: "b1e4a2c0-2222-4a22-8a22-0000000000a2",
  growth: "b1e4a2c0-3333-4a33-8a33-0000000000a3",
  locations: "b1e4a2c0-4444-4a44-8a44-0000000000a4",
  ehr: "b1e4a2c0-5555-4a55-8a55-0000000000a5",
  contact: "b1e4a2c0-6666-4a66-8a66-0000000000a6",
} as const;

const SRC = {
  staffing:
    "https://www.indeed.com/jobs?q=patient+coordinator&l=Austin%2C+TX",
  reviews:
    "https://www.google.com/maps/search/dermatology+austin+reviews",
  growth:
    "https://www.beckersasc.com/dermatology/",
  ehr: "https://www.modmed.com/dermatology/",
  proof:
    "https://eliseai.com/customer-stories/how-texas-dermatology-uses-eliseai-to-stop-missing-calls-and-capture-250-new-patients-every-month",
  linkedin: "https://www.linkedin.com/in/example-practice-manager",
} as const;

/**
 * ⚡ The hero brief, Cedarline Dermatology Group, three fresh signals firing.
 * The same practice the feed opens into, so the feed → brief story is coherent.
 */
export function demoBrief(now: Date): RenderedBrief {
  const factual: RenderedBrief["factual"] = {
    schemaVersion: BRIEF_SCHEMA_VERSION,
    vertical: "dermatology",
    practiceName: "Cedarline Dermatology Group",
    city: "Austin",
    state: "TX",
    zeroSignal: false,
    headline: null,
    profile: [
      {
        label: "Locations",
        value: "4 clinics across Greater Austin",
        evidenceId: EV.locations,
        sourceUrl: "https://cedarlinederm.example.com/locations",
        quote: null,
        href: "https://cedarlinederm.example.com/locations",
      },
      {
        label: "Patient volume",
        value: "~50 providers, cosmetic + medical lines",
        evidenceId: EV.locations,
        sourceUrl: "https://cedarlinederm.example.com/about",
        quote: null,
        href: "https://cedarlinederm.example.com/about",
      },
      {
        label: "Front-desk load",
        value: "Est. 2,000+ inbound calls/mo across sites",
        evidenceId: EV.reviews,
        sourceUrl: SRC.reviews,
        quote: null,
        href: SRC.reviews,
      },
    ],
    incumbentTooling: [
      {
        label: "EHR / scheduling",
        value: "ModMed EMA (Dermatology)",
        evidenceId: EV.ehr,
        sourceUrl: SRC.ehr,
        quote: "The all-in-one dermatology EHR, practice management and more",
        href: SRC.ehr,
      },
      {
        label: "Front desk",
        value: "In-house reception, no AI phone layer detected",
        evidenceId: EV.reviews,
        sourceUrl: SRC.reviews,
        quote: null,
        href: SRC.reviews,
      },
    ],
    buyingMomentContext: [
      {
        label: "Front-desk staffing spike",
        value: "3 open patient-coordinator / front-desk reqs posted this week",
        evidenceId: EV.staffing,
        sourceUrl: SRC.staffing,
        quote: "seeking patient coordinators to manage high call volume",
        href: SRC.staffing,
      },
      {
        label: "Phone-complaint reviews",
        value: "Recent 1-star reviews cite hold times and unanswered calls",
        evidenceId: EV.reviews,
        sourceUrl: SRC.reviews,
        quote: "on hold for 20 minutes and then got cut off",
        href: SRC.reviews,
      },
      {
        label: "Growth event",
        value: "Announced a 5th location opening in Q4",
        evidenceId: EV.growth,
        sourceUrl: SRC.growth,
        quote: null,
        href: SRC.growth,
      },
    ],
    painFit:
      "High call volume split across cosmetic and medical lines, spiking at skin-check season, and every missed call is a new patient who books with the practice down the street. The front desk can't staff its way out; EliseAI answers every line, every time, and turns missed calls into booked appointments.",
    proofPoint: {
      tag: "real",
      caseStudy: "Texas Dermatology",
      metrics: [
        "2,000 calls per month handled by Elise",
        "600+ appointments scheduled per month",
        "250+ new patients booked every month",
        "130+ hours of routine work per month off staff",
      ],
      sourceUrl: SRC.proof,
      href: SRC.proof,
    },
    roiRange: {
      tag: "modeled",
      items: [
        {
          label:
            "In-person dermatology no-show rate: 13.4% (711 of 5,315 visits, 2020 chart review)",
          sourceUrl: "https://pmc.ncbi.nlm.nih.gov/articles/PMC7484689/",
          href: "https://pmc.ncbi.nlm.nih.gov/articles/PMC7484689/",
        },
        {
          label: "Average cost per no-show: $196",
          sourceUrl: "https://pmc.ncbi.nlm.nih.gov/articles/PMC4714455/",
          href: "https://pmc.ncbi.nlm.nih.gov/articles/PMC4714455/",
        },
        {
          label:
            "Call-volume anchor: a ~50-person derm group fields ~2,000 Elise-handled calls/mo",
          sourceUrl: SRC.proof,
          href: SRC.proof,
        },
      ],
    },
    contact: {
      variant: "named",
      name: "Dana Reyes",
      role: "Practice Manager",
      email: "d.reyes@cedarlinederm.example.com",
      emailProvider: "pdl",
      linkedinUrl: SRC.linkedin,
      bestChannel: "Email, then a follow-up call before 10am",
      sourceUrl: "https://cedarlinederm.example.com/team",
      sourceHref: "https://cedarlinederm.example.com/team",
      linkedinHref: SRC.linkedin,
      facebookHref:
        "https://www.facebook.com/search/people/?q=Dana%20Reyes%20Cedarline%20Dermatology",
    },
    signalFingerprint: [
      `growth_events:${EV.growth}`,
      `phone_complaints:${EV.reviews}`,
      `staffing_spike:${EV.staffing}`,
    ],
  };

  const voice: RenderedBrief["voice"] = {
    headline: "Front desk underwater right as a 5th location opens",
    headlineEvidenceIds: [EV.staffing, EV.growth],
    // Kept within VOICE_LIMITS.callOpener (320) so this fixture is a brief a real
    // generation could actually produce, and so it survives `getBrief`'s re-validation
    // when seeded into the DB (the styleguide renders it un-validated; the real route does not).
    callOpener:
      "Hi Dana, most derm groups your size are losing the phone battle at screening season, and the ones winning aren't adding front-desk headcount, they're making sure zero new-patient calls ring out. With the 5th location opening, I'd love to show you how practices like Texas Dermatology capture 250+ new patients a month.",
    callOpenerEvidenceIds: [EV.staffing, EV.growth, EV.reviews],
    personalizationSnippet:
      "You're hiring three front-desk coordinators this week and just announced a fifth clinic, the phones are about to get louder, not quieter.",
    personalizationEvidenceIds: [EV.staffing, EV.growth],
    sequence: {
      touches: [
        {
          touchNumber: 1,
          channel: "email",
          subject: "3 new front-desk reqs, before you hire",
          body: "Hi Dana,\n\nSaw Cedarline is opening a fifth location and hiring three patient coordinators. Before you add headcount to cover the phones, worth a look: Texas Dermatology handles 2,000 calls a month with EliseAI and books 250+ new patients, no missed calls, no hold times.\n\nWorth 15 minutes to see if it fits Cedarline?\n\nDana",
          evidenceIds: [EV.staffing, EV.growth],
        },
        {
          touchNumber: 2,
          channel: "email",
          subject: "the reviews mention hold times",
          body: "Hi Dana, quick follow-up. A few recent reviews mention long holds and dropped calls. That's exactly the moment a new patient calls the practice down the street. EliseAI answers every line, every time. Happy to share the Texas Dermatology numbers on a short call.",
          evidenceIds: [EV.reviews],
        },
        {
          touchNumber: 3,
          channel: "email",
          subject: "closing the loop on Cedarline's phones",
          body: "Hi Dana, I'll leave this here so it's not sitting in your inbox. If the phones are keeping up as the fifth location opens, no need to reply. If new-patient calls are still slipping through at the busy stretches, I'm around whenever you want to compare notes on how Texas Dermatology runs it. Either way, I'll get out of your inbox.",
          evidenceIds: [EV.growth],
        },
      ],
      namedCta: "Book a 15-minute Cedarline fit call",
    },
    discoveryQuestions: [
      "How are you covering the phones across all four locations today, and what changes when the fifth opens?",
      "Roughly how many new-patient calls do you think go unanswered on a busy day?",
      "Is capturing more new patients or reducing front-desk workload the bigger priority right now?",
    ],
    objections: [
      {
        objection: "We just hired more front-desk staff.",
        rebuttal:
          "Makes sense, and EliseAI isn't a replacement for them, it's the layer that catches every call they can't get to, especially after hours and during skin-check season. Your team handles the complex conversations; Elise makes sure nothing rings out.",
      },
      {
        objection: "Our patients want to talk to a real person.",
        rebuttal:
          "They still can. Elise routes anything clinical or complex straight to your team. What it removes is the hold music and the voicemail. Texas Dermatology's patients book 250+ appointments a month this way.",
      },
      {
        objection: "We're already on ModMed for scheduling.",
        rebuttal:
          "Perfect. EliseAI writes straight into ModMed, so it books into the schedule you already run. Kansas City Skin & Cancer Center went live on ModMed in 24 hours. It's additive, not a rip-and-replace.",
      },
    ],
  };

  return {
    factual,
    voice,
    headline: voice.headline ?? "Front desk underwater right as a 5th location opens",
    // Happy-path demo: the prose was written against exactly these fresh signals,
    // so nothing has diverged and no "regenerate" affordance should show.
    stale: false,
    live: {
      signalCount: 3,
      freshness: "today",
      mostRecentDetectedAt: daysAgo(now, 1),
      firedSignals: [
        {
          kind: "staffing_spike",
          signalSource: "Indeed",
          detectedAt: daysAgo(now, 1),
          expiresAt: daysAhead(now, 29),
          confidence: 0.92,
          freshnessWeight: 0.97,
          evidenceId: EV.staffing,
          sourceUrl: SRC.staffing,
          href: SRC.staffing,
        },
        {
          kind: "phone_complaints",
          signalSource: "Google Reviews",
          detectedAt: daysAgo(now, 4),
          expiresAt: daysAhead(now, 56),
          confidence: 0.81,
          freshnessWeight: 0.93,
          evidenceId: EV.reviews,
          sourceUrl: SRC.reviews,
          href: SRC.reviews,
        },
        {
          kind: "growth_events",
          signalSource: "Becker's / press",
          detectedAt: daysAgo(now, 9),
          expiresAt: daysAhead(now, 81),
          confidence: 0.74,
          freshnessWeight: 0.9,
          evidenceId: EV.growth,
          sourceUrl: SRC.growth,
          href: SRC.growth,
        },
      ],
    },
  };
}

/**
 * ⚡ The feed, a ranked flow of prospects at a buying moment (D8: signal count first).
 * Mirrors the FeedItem shape `app/page.tsx` hands to `<Feed>`.
 */
export function demoFeedItems(): FeedItem[] {
  return [
    {
      id: "demo-cedarline",
      name: "Cedarline Dermatology Group",
      vertical: "dermatology",
      signalKinds: ["staffing_spike", "phone_complaints", "growth_events"],
      freshestAgeDays: 1,
      freshestKind: "staffing_spike",
      freshestIsFresh: true,
    },
    {
      id: "demo-harborlight",
      name: "Harborlight Women's Health",
      vertical: "womens-health",
      signalKinds: ["staffing_spike", "phone_complaints"],
      freshestAgeDays: 3,
      freshestKind: "phone_complaints",
      freshestIsFresh: true,
    },
    {
      id: "demo-summit-ortho",
      name: "Summit Orthopedic Partners",
      vertical: "orthopedics",
      signalKinds: ["growth_events", "phone_complaints"],
      freshestAgeDays: 6,
      freshestKind: "phone_complaints",
      freshestIsFresh: true,
    },
    {
      id: "demo-clearview-eye",
      name: "Clearview Eye Associates",
      vertical: "ophthalmology",
      signalKinds: ["staffing_spike"],
      freshestAgeDays: 2,
      freshestKind: "staffing_spike",
      freshestIsFresh: true,
    },
    {
      id: "demo-riverside-womens",
      name: "Riverside Women's Care",
      vertical: "womens-health",
      signalKinds: ["growth_events"],
      freshestAgeDays: 12,
      freshestKind: "growth_events",
      freshestIsFresh: true,
    },
    {
      id: "demo-meridian-eye",
      name: "Meridian Eye Care Associates",
      vertical: "ophthalmology",
      signalKinds: ["growth_events"],
      freshestAgeDays: 34,
      freshestKind: "growth_events",
      freshestIsFresh: true,
    },
  ];
}

/**
 * 📈 The ROI scoreboard (U12). Illustrative numbers, in production these are
 * computed from `roi_events` / `cost_events` (D10). The honesty tags below are the
 * demo's honest self-report: pipeline-outcome numbers are MODELED until real deals
 * flow; the tool's own activity counts (meetings, hours, touches) are MEASURED.
 */
const REASONS = [
  { label: "Too small", count: 24 },
  { label: "Wrong specialty", count: 16 },
  { label: "Already a customer", count: 13 },
  { label: "Bad timing", count: 18 },
];

function mkScope(p: {
  deals: string;
  dealsDelta: string;
  cac: string;
  cacDelta: string;
  meetings: string;
  meetingsDelta: string;
  costPerMtg: string;
  costDelta: string;
  touches: string;
  touchesDelta: string;
  hours: string;
  hoursDelta: string;
  conv: [number, number, number];
  convDetail: [string, string, string];
  overall: number;
  upRate: number;
  rated: number;
}): ScopeData {
  return {
    endGoals: [
      {
        label: "Deals won, this quarter",
        value: p.deals,
        delta: p.dealsDelta,
        deltaTone: "positive",
        honesty: "modeled",
        caption: "Are we closing more? The revenue outcome every sign below points at.",
      },
      {
        label: "Cost to win a customer (CAC)",
        value: p.cac,
        delta: p.cacDelta,
        deltaTone: "positive",
        honesty: "modeled",
        caption: "Does each new customer cost less? Real tool spend ÷ new customers.",
      },
    ],
    leading: [
      {
        label: "Meetings the tool booked",
        value: p.meetings,
        delta: p.meetingsDelta,
        deltaTone: "positive",
        honesty: "measured",
        caption: "Prove the tool's pulling weight → expand it.",
      },
      {
        label: "Cost per meeting",
        value: p.costPerMtg,
        delta: p.costDelta,
        deltaTone: "positive",
        honesty: "measured",
        caption: "Put budget where meetings are cheapest.",
      },
      {
        label: "Messages to land a meeting",
        value: p.touches,
        delta: p.touchesDelta,
        deltaTone: "positive",
        honesty: "measured",
        caption: "Fix the sequences that aren't landing.",
      },
      {
        label: "Hours saved this month",
        value: p.hours,
        delta: p.hoursDelta,
        deltaTone: "positive",
        honesty: "measured",
        caption: "Free reps to sell more → roll it out wider.",
      },
    ],
    signalConversion: [
      { kind: "staffing-spike", label: "Staffing spike", rate: p.conv[0], detail: p.convDetail[0] },
      { kind: "phone-complaints", label: "Phone complaints", rate: p.conv[1], detail: p.convDetail[1] },
      { kind: "growth-events", label: "Growth event", rate: p.conv[2], detail: p.convDetail[2] },
    ],
    overallConversion: p.overall,
    feedback: { thumbsUpRate: p.upRate, total: p.rated, reasons: REASONS },
  };
}

export function demoScoreboard(): ScoreboardData {
  return {
    scopes: {
      // Enterprise-scale demo funnel, mirroring the `enterprise-demo-seed` seed the
      // live scoreboard reads (1,240 leads → 340 meetings → 92 deals). CAC + cost/mtg
      // are the real computed ratios (≈$3,731 tool spend over deals / meetings) — the
      // whole point of the ROI board is a CAC of a few dollars, not four figures.
      all: mkScope({
        deals: "92", dealsDelta: "+41 vs last qtr",
        cac: "$41", cacDelta: "−63% vs last qtr",
        meetings: "340", meetingsDelta: "+88 vs last month",
        costPerMtg: "$11", costDelta: "−22% vs last month",
        touches: "3.0", touchesDelta: "−0.6 vs last month",
        hours: "14819", hoursDelta: "+2,190 vs last month",
        conv: [0.29, 0.27, 0.26],
        convDetail: ["120 meetings / 414 leads", "112 meetings / 415 leads", "108 meetings / 411 leads"],
        overall: 0.274, upRate: 0.827, rated: 411,
      }),
      dermatology: mkScope({
        deals: "38", dealsDelta: "+18 vs last qtr",
        cac: "$26", cacDelta: "−58% vs last qtr",
        meetings: "105", meetingsDelta: "+31 vs last month",
        costPerMtg: "$9", costDelta: "−24% vs last month",
        touches: "3.0", touchesDelta: "−0.5 vs last month",
        hours: "4271", hoursDelta: "+640 vs last month",
        conv: [0.36, 0.33, 0.31],
        convDetail: ["38 meetings / 106 leads", "35 meetings / 107 leads", "32 meetings / 108 leads"],
        overall: 0.327, upRate: 0.861, rated: 122,
      }),
      "womens-health": mkScope({
        deals: "27", dealsDelta: "+12 vs last qtr",
        cac: "$35", cacDelta: "−49% vs last qtr",
        meetings: "88", meetingsDelta: "+22 vs last month",
        costPerMtg: "$11", costDelta: "−18% vs last month",
        touches: "3.0", touchesDelta: "−0.4 vs last month",
        hours: "3874", hoursDelta: "+520 vs last month",
        conv: [0.31, 0.28, 0.25],
        convDetail: ["32 meetings / 104 leads", "29 meetings / 104 leads", "27 meetings / 104 leads"],
        overall: 0.282, upRate: 0.838, rated: 105,
      }),
      ophthalmology: mkScope({
        deals: "7", dealsDelta: "+4 vs last qtr",
        cac: "$126", cacDelta: "−31% vs last qtr",
        meetings: "64", meetingsDelta: "+18 vs last month",
        costPerMtg: "$14", costDelta: "−11% vs last month",
        touches: "3.0", touchesDelta: "−0.3 vs last month",
        hours: "3191", hoursDelta: "+430 vs last month",
        conv: [0.24, 0.21, 0.19],
        convDetail: ["24 meetings / 101 leads", "21 meetings / 100 leads", "19 meetings / 101 leads"],
        overall: 0.212, upRate: 0.78, rated: 82,
      }),
      orthopedics: mkScope({
        deals: "20", dealsDelta: "+9 vs last qtr",
        cac: "$46", cacDelta: "−42% vs last qtr",
        meetings: "83", meetingsDelta: "+19 vs last month",
        costPerMtg: "$11", costDelta: "−14% vs last month",
        touches: "3.0", touchesDelta: "−0.2 vs last month",
        hours: "3483", hoursDelta: "+410 vs last month",
        conv: [0.3, 0.27, 0.24],
        convDetail: ["30 meetings / 102 leads", "28 meetings / 101 leads", "25 meetings / 102 leads"],
        overall: 0.272, upRate: 0.83, rated: 100,
      }),
    },
    verticals: [
      { slug: "dermatology", label: "Dermatology", winRate: 0.118, costPerMeeting: "$9", cycleDays: "31d" },
      { slug: "womens-health", label: "Women's Health", winRate: 0.087, costPerMeeting: "$11", cycleDays: "39d" },
      { slug: "ophthalmology", label: "Ophthalmology", winRate: 0.023, costPerMeeting: "$14", cycleDays: "44d" },
      { slug: "orthopedics", label: "Orthopedics", winRate: 0.066, costPerMeeting: "$11", cycleDays: "46d" },
    ],
    bigTest: {
      buyingMoment: { meetings: 322, deals: 89 },
      cold: { meetings: 18, deals: 3 },
    },
  };
}
