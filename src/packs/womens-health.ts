import type { PackInput } from "./schema";

/**
 * Women's Health / OB-GYN pack (U13) — authored voice + cited proof,
 * transcribed verbatim from `wave1-research/vertical-packs.md` (Pack 2).
 * Every URL below is also in the ledger at `docs/pack-sources.md`.
 *
 * Backup proof (verified, NOT used — one proof point per pack): Southdale
 * OBGYN & MetroPartners OBGYN — 3,000+ appointments scheduled combined,
 * 50-62% of eligible inbound calls handled by Elise, 450 new patient charts,
 * 42+ hours of staff work saved, voicemail backlog cut from hundreds to ~20
 * on a typical Friday, 3 FTEs absorbed through natural attrition —
 * https://eliseai.com/healthcare-customer-stories/how-southdale-obgyn-tamed-volume-surges-and-metropartners-obgyn-unlocked-multilingual-access-with-eliseai
 *
 * Dropped per the no-fabrication rule: the spec's "Women's Excellence"
 * candidate — no citable EliseAI page surfaced. See docs/pack-sources.md.
 */
export const womensHealthPack: PackInput = {
  vertical: "womens_health",

  painFit: {
    line: "Call volume surges no front desk can staff for — hundreds to a thousand calls a day across locations, 10–25 minute holds, and half of callers hanging up before anyone answers. In OB, an abandoned call isn't a lost sale, it's a pregnant patient who couldn't reach her practice. EliseAI answers instantly, schedules against real clinical context, and cuts the calls staff must touch in half.",
    grounding:
      "Women's Health Connecticut's pre-Elise state — hold times of 10–25 minutes and 50–60% call abandonment — https://eliseai.com/blog/ai-agents-for-care-centers. \"A multi-location women's health practice handling 600 to 1,000 calls daily…\" — https://eliseai.com/blog/why-speed-matters-how-eliseai-gets-practices-live-in-weeks-not-months",
  },

  opener: {
    leadWith:
      "patient access as patient safety/continuity — abandoned calls and hold times, not revenue. This vertical carries the highest emotional stakes of the four; lead with the patient experience, close with the staffing math.",
    vocabulary: [
      "abandoned calls",
      "hold times",
      "patients who give up",
      "OB volume surges",
      "triage vs. routine scheduling",
      "your nurses answering phones instead of patients",
      "multilingual access",
    ],
    tone: "warm, mission-aligned, clinically respectful — never \"call center\" language; these are practices that see themselves as caring for women through the most important moments of their lives.",
    exampleOpener:
      "When an OB practice's phones back up, it's not lost revenue — it's a pregnant patient who couldn't get through. Groups your size were dropping half their inbound calls before they fixed access; the fix wasn't more front-desk hires.",
  },

  proofPoint: {
    tag: "real",
    caseStudy: "Women's Health Connecticut",
    metrics: [
      "52% reduction in staff-handled calls",
      "10 hours per day saved",
      "hold times dropped from 10-25 minutes to under 20 seconds",
      "call abandonment fell from 50-60% to just 5%",
    ],
    sourceUrl: "https://eliseai.com/blog/ai-agents-for-care-centers",
  },

  // Caveat (per research): most large women's-health groups run generalist
  // EHRs (athenahealth, eClinicalWorks, Veradigm, AdvancedMD) which EliseAI
  // integrates with but which do NOT flag this vertical on their own — for
  // OB-GYN, EHR is a weak solo signal. digiChart is the high-precision/
  // low-recall flag; classify primarily on specialty keywords.
  ehrSignals: [
    {
      name: "digiChart / digi2.0 (OB-GYN)",
      sourceUrl: "https://digichart.com/ob-gyn/",
    },
  ],

  roiBenchmark: {
    tag: "modeled",
    items: [
      {
        label:
          "Missed-appointment rate: 28% average in a high-risk obstetric clinic (Journal of Women's Health & Gender-Based Medicine, 2000)",
        sourceUrl: "https://pubmed.ncbi.nlm.nih.gov/11074955/",
      },
      {
        label:
          "Call volume: a multi-location women's health practice handles 600-1,000 calls daily (vendor-reported)",
        sourceUrl:
          "https://eliseai.com/blog/why-speed-matters-how-eliseai-gets-practices-live-in-weeks-not-months",
      },
      {
        label: "Average cost per no-show: $196 (2008 dollars)",
        sourceUrl: "https://pmc.ncbi.nlm.nih.gov/articles/PMC4714455/",
      },
    ],
  },
};
