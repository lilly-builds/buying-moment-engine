import type { PackInput } from "./schema";

/**
 * Dermatology pack (U13) — authored voice + cited proof, transcribed verbatim
 * from `wave1-research/vertical-packs.md` (Pack 1). Every URL below is also
 * in the ledger at `docs/pack-sources.md` — nothing here was invented.
 *
 * Backup proof (verified, NOT used — one proof point per pack): Kansas City
 * Skin & Cancer Center went live via ModMed in 24 hours; Elise now schedules
 * 1,850+ appointments/month —
 * https://eliseai.com/blog/modmed-ai-scheduling-in-action-how-kansas-city-skin-cancer-center-went-live-in-24-hours-with-elise
 *
 * Dropped per the no-fabrication rule: the spec's "Georgia Dermatology (88%
 * of calls handled, 3+ hrs/day saved)" — could not be verified anywhere
 * public. See docs/pack-sources.md for the negative-result note.
 */
export const dermatologyPack: PackInput = {
  vertical: "dermatology",

  painFit: {
    line: "High call volume split across cosmetic and medical lines, spiking at skin-check season — and every missed call is a new patient who books with the practice down the street. The front desk can't staff its way out; EliseAI answers every line, every time, and turns missed calls into booked appointments.",
    grounding:
      "EliseAI's dermatology page positions Elise as handling ~90% of non-clinical conversations and replacing the staffing effort of 4 FTEs (vendor-stated, unattributed) — https://eliseai.com/health/dermatology. Texas Dermatology's story is framed entirely around calls that used to be missed becoming captured new patients — https://eliseai.com/customer-stories/how-texas-dermatology-uses-eliseai-to-stop-missing-calls-and-capture-250-new-patients-every-month",
  },

  opener: {
    leadWith:
      "missed calls = lost new patients (dermatology is a volume + acquisition game; new-patient demand is elastic and shoppers call multiple practices).",
    vocabulary: [
      "missed calls",
      "new-patient capture",
      "cosmetic vs. medical lines",
      "skin-check season",
      "same-day fills",
      "your front desk is underwater, not underperforming",
    ],
    tone: "commercially sharp, revenue-forward — derm groups (often PE-backed/MSO) think in growth and throughput; it's the most consumer/retail-minded of the four verticals.",
    exampleOpener:
      "Most derm groups your size are losing the phone battle around screening season — the practices winning right now aren't adding front-desk headcount, they're making sure zero new-patient calls ring out.",
  },

  proofPoint: {
    tag: "real",
    caseStudy: "Texas Dermatology",
    metrics: [
      "2,000 calls per month handled by Elise",
      "600+ appointments scheduled per month",
      "250+ new patients booked every month",
      "130+ hours of routine work per month taken off staff",
    ],
    sourceUrl:
      "https://eliseai.com/customer-stories/how-texas-dermatology-uses-eliseai-to-stop-missing-calls-and-capture-250-new-patients-every-month",
  },

  ehrSignals: [
    {
      name: "ModMed EMA (Dermatology)",
      sourceUrl: "https://www.modmed.com/dermatology/",
    },
    {
      name: "Nextech (Dermatology)",
      sourceUrl: "https://www.nextech.com/",
    },
  ],

  roiBenchmark: {
    tag: "modeled",
    items: [
      {
        label:
          "In-person dermatology clinic no-show rate: 13.4% (711 of 5,315 visits; 2020 retrospective chart review)",
        sourceUrl: "https://pmc.ncbi.nlm.nih.gov/articles/PMC7484689/",
      },
      {
        label:
          "Lower-bound dermatology no-show rate: 7.79% (single universal-payer derm practice, 2007)",
        sourceUrl: "https://pubmed.ncbi.nlm.nih.gov/17374315/",
      },
      {
        label: "Average cost per no-show: $196 (2008 dollars)",
        sourceUrl: "https://pmc.ncbi.nlm.nih.gov/articles/PMC4714455/",
      },
      {
        label:
          "Call-volume anchor: a ~50-person, multi-location derm group fields ~2,000 Elise-handled calls/month (Texas Dermatology)",
        sourceUrl:
          "https://eliseai.com/customer-stories/how-texas-dermatology-uses-eliseai-to-stop-missing-calls-and-capture-250-new-patients-every-month",
      },
    ],
  },
};
