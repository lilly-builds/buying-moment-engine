import type { PackInput } from "./schema";

/**
 * Ophthalmology pack (U13) — authored voice + cited proof, transcribed
 * verbatim from `wave1-research/vertical-packs.md` (Pack 3). Every URL below
 * is also in the ledger at `docs/pack-sources.md`.
 *
 * This closes the spec's "confirm a hard metric for Grin Eye Care" gap —
 * three hard metrics confirmed on the source page (fetched 2026-07-07).
 */
export const ophthalmologyPack: PackInput = {
  vertical: "ophthalmology",

  painFit: {
    line: "An ophthalmology schedule lives on routine, repeatable volume — annual exams, post-op checks, recalls — yet over a third of eligible patients never book their annual exam, and long lead times quietly triple no-shows. The phone work is high-volume and low-complexity: exactly the calls EliseAI takes off the front desk entirely.",
    grounding:
      "\"Thirty-five percent of eligible patients don't attend their annual eye exams\" (vendor-stated) — https://eliseai.com/blog/how-ophthalmology-practices-manage-patient-phone-calls-with-ai. Lead-time/no-show relationship — https://pmc.ncbi.nlm.nih.gov/articles/PMC4370946/",
  },

  opener: {
    leadWith:
      "recapturing routine volume — recalls, annual-exam compliance, and no-show decay on long lead times. Ophthalmology's pain is leakage on predictable, recurring appointments, not chaos.",
    vocabulary: [
      "annual exam recall",
      "post-op follow-ups",
      "lead time",
      "schedule density",
      "optical vs. medical lines",
      "no-show decay",
      "your techs shouldn't be rebooking cataract post-ops",
    ],
    tone: "operational and precise — ophthalmology practices run high-throughput, procedure-driven schedules (cataract volume is a production line); speak in utilization and slots, with a patient-compliance angle for the medical side.",
    exampleOpener:
      "Every ophthalmology group we look at has the same silent leak: annual-exam recalls that never get booked and long-lead appointments that no-show at 3x the rate. The fix isn't more reminder postcards — it's answering and booking every one of those calls the moment they happen.",
  },

  proofPoint: {
    tag: "real",
    caseStudy: "Grin Eye Care (3-location eye-care group, Kansas City metro, on ModMed)",
    metrics: [
      "700+ calls handled per month by EliseAI",
      "200+ appointments scheduled per month without staff involvement",
      "50 hours of front-desk time saved per month",
    ],
    sourceUrl:
      "https://eliseai.com/blog/inside-grin-eye-cares-ai-scheduling-rollout",
  },

  ehrSignals: [
    {
      name: "ModMed (Ophthalmology suite)",
      sourceUrl: "https://www.modmed.com/ophthalmology/",
    },
    {
      name: "Nextech (Ophthalmology)",
      sourceUrl: "https://www.nextech.com/ophthalmology/ehr-system",
    },
  ],

  roiBenchmark: {
    tag: "modeled",
    items: [
      {
        label:
          "No-show rate: 21.7% average in resident ophthalmology clinics / 6.6% in faculty clinics; climbs with lead time — 9.1% at 0-2 weeks to 38.3% at 6 months (Clinical Ophthalmology, 2015)",
        sourceUrl: "https://pmc.ncbi.nlm.nih.gov/articles/PMC4370946/",
      },
      {
        label:
          "Missed-call context: average medical-practice dropped-call rate cited at 23% (industry stat as cited by EliseAI)",
        sourceUrl:
          "https://eliseai.com/blog/inside-grin-eye-cares-ai-scheduling-rollout",
      },
      {
        label: "Average cost per no-show: $196 (2008 dollars)",
        sourceUrl: "https://pmc.ncbi.nlm.nih.gov/articles/PMC4714455/",
      },
    ],
  },
};
