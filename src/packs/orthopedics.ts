import type { PackInput } from "./schema";

/**
 * Orthopedics pack (U13) — authored voice, transcribed verbatim from
 * `wave1-research/vertical-packs.md` (Pack 4). Every URL below is also in the
 * ledger at `docs/pack-sources.md`.
 *
 * Proof point ships the explicit `proof_pending` sentinel — NEVER a
 * fabricated or proxy metric. Research performed 2026-07-07 (per the
 * never-fake rule) checked: EliseAI's healthcare customer-stories index
 * (5 stories: 4 derm + 1 OB-GYN, zero ortho), the healthai overview's full
 * linked-story list (no ortho story), the orthopedics vertical page (no
 * named customer; one uncontextualized "34%" graphic with no attribution),
 * the orthopedic blog post (platform/industry stats only, zero named
 * customers), Series-E and $200M-ARR press, and LinkedIn/press sweeps across
 * multiple query variants. No named EliseAI orthopedics or surgery-center
 * customer with a citable metric exists publicly as of 2026-07-07. This is a
 * config value to fill the moment a real metric surfaces — see
 * docs/pack-sources.md for the full negative-result trail.
 */
export const orthopedicsPack: PackInput = {
  vertical: "orthopedics",

  painFit: {
    line: "Orthopedic phone work is the most complex of the four verticals: every caller must be routed to the right subspecialty (sports medicine vs. joint vs. spine), insurance and workers'-comp rules checked before booking, and referrals honored — insurance qualification alone is 1 in 7 patient calls, and 40%+ of after-hours calls are scheduling-related. Staff burn hours on triage a machine can do on the first ring; EliseAI routes, verifies, and books directly in the EHR.",
    grounding:
      "\"Insurance qualification accounts for 14% of patient calls\" · \"Over 40% of after-hours calls are scheduling-related\" · \"one in six after-hours appointments are made by new patients\" (vendor-stated) — https://eliseai.com/blog/orthopedic-ai-call-automation-how-eliseai-eliminates-hold-times-and-automates-insurance-checks. Subspecialty routing — https://eliseai.com/health/orthopedic",
  },

  opener: {
    leadWith:
      "routing + verification complexity, not raw volume. Ortho's pain is that every call requires judgment (which subspecialty? which plan? work comp? referral in hand?) before it can even be scheduled — so the front desk becomes a triage bottleneck.",
    vocabulary: [
      "subspecialty routing",
      "sports med vs. joint vs. spine",
      "insurance verification",
      "workers' comp",
      "referral capture",
      "after-hours new patients",
      "surgical schedulers doing phone triage",
    ],
    tone: "systems-minded and efficiency-driven — ortho groups (and their MSO/ASC operators) think in throughput, referral leakage, and surgical conversion; be concrete about the routing logic, they will test whether you understand it.",
    exampleOpener:
      "In most ortho groups, a scheduler can't book a single appointment until they've figured out the subspecialty, the insurance plan, and whether it's workers' comp — that's why insurance questions alone eat one in seven calls. The groups getting ahead of it aren't hiring more schedulers; they're automating that first five minutes of every call.",
  },

  // Explicit sentinel — NOT a silently-blank proof. Renders on the card as
  // "Proof pending — no customer success metrics found."
  proofPoint: {
    tag: "proof_pending",
  },

  ehrSignals: [
    {
      name: "Phoenix Ortho",
      sourceUrl: "https://www.phoenixortho.net/",
    },
    {
      name: "ModMed Orthopedics (absorbed Exscribe)",
      sourceUrl: "https://www.modmed.com/specialties/orthopedics/",
    },
    {
      name: "Nextech (Orthopedic)",
      sourceUrl: "https://www.nextech.com/orthopedic/ehr-system",
    },
  ],

  roiBenchmark: {
    tag: "modeled",
    items: [
      {
        label:
          "No-show rate: 16% in an orthopedics department's ambulatory clinics (overall ambulatory ~15%; Israel Journal of Health Policy Research, 2019)",
        sourceUrl: "https://pmc.ncbi.nlm.nih.gov/articles/PMC6664577/",
      },
      {
        label:
          "Call-mix context (vendor-stated): insurance qualification = 14% of patient calls; 40%+ of after-hours calls are scheduling-related; 1 in 6 after-hours appointments are new patients",
        sourceUrl:
          "https://eliseai.com/blog/orthopedic-ai-call-automation-how-eliseai-eliminates-hold-times-and-automates-insurance-checks",
      },
      {
        label: "Average cost per no-show: $196 (2008 dollars)",
        sourceUrl: "https://pmc.ncbi.nlm.nih.gov/articles/PMC4714455/",
      },
    ],
  },
};
