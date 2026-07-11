import { gradients } from "@/design/tokens";
import { getPack } from "@/src/packs";
import { DEFAULT_TARGET } from "@/src/target/config";
import { WorkspaceConfigSchema, type WorkspaceConfig } from "./schema";

/**
 * ELISEAI_DEFAULT — the synthetic default workspace (plan § "Active
 * workspace? no -> existing EliseAI code defaults, unchanged"). Built
 * faithfully from the code-level seams that already exist rather than
 * invented copy:
 *   - `DEFAULT_TARGET` (`src/target/config.ts`) for product/company name.
 *   - `design/tokens.ts` (`themeVars`, `gradients.healthHero`) for brand hexes.
 *   - the dermatology `VerticalPack` (`src/packs/dermatology.ts`) for pitch +
 *     proof — EliseAI's real, cited voice and case-study numbers.
 *   - `src/discovery/tenants.ts` (the live EliseAI tenant profile) and
 *     `src/enrich/research-prompt.ts` for business/ICP/geography/decision-maker
 *     grounding, and `src/engine/freshness.ts` for the real per-signal
 *     freshness windows.
 *
 * `sampleFeed: []` on purpose: the default workspace renders its feed from
 * the real `practices` table (existing EliseAI data), never a generated
 * sample — only a workspace built by the Adapter onboarding populates
 * `sampleFeed` (plan § scope item 1).
 *
 * Validated against `WorkspaceConfigSchema` at module load (fail loud,
 * mirrors `getPack` / `getTenantProfile`): if this default ever drifts out of
 * the schema's shape, the app fails to boot instead of shipping a malformed
 * default silently.
 */

const derm = getPack("dermatology");

/**
 * Pull the hero gradient's actual from/to stops out of `gradients.healthHero`
 * instead of re-typing the hexes here, so the default workspace can never
 * drift from the real token (design/tokens.ts is locked by a parity test and
 * is never edited to re-skin — see the design north star).
 */
function heroStops(gradient: string): { from: string; to: string } {
  const hexes = gradient.match(/#[0-9a-f]{6}/gi);
  if (!hexes || hexes.length < 2) {
    throw new Error(
      "gradients.healthHero must contain at least two #rrggbb stops",
    );
  }
  return { from: hexes[0], to: hexes[hexes.length - 1] };
}

const hero = heroStops(gradients.healthHero);

/**
 * The dermatology pack's proof point is ONE case study with several metrics
 * under one source URL (`src/packs/schema.ts`). The workspace proof shape is
 * a list of individual `{claim, metric, sourceUrl}` points, so each metric
 * becomes its own proof point, claimed by the same cited case study — no
 * number here is invented, every one is transcribed from the pack.
 */
const proof: WorkspaceConfig["proof"] =
  derm.proofPoint.tag === "real"
    ? derm.proofPoint.metrics.map((metric) => ({
        claim: derm.proofPoint.tag === "real" ? derm.proofPoint.caseStudy : "",
        metric,
        sourceUrl: derm.proofPoint.tag === "real" ? derm.proofPoint.sourceUrl : "",
      }))
    : [{ claim: `${DEFAULT_TARGET.orgName} dermatology results`, tag: "pending" as const }];

export const ELISEAI_DEFAULT: WorkspaceConfig = WorkspaceConfigSchema.parse({
  brand: {
    productName: DEFAULT_TARGET.productName,
    companyName: DEFAULT_TARGET.orgName,
    primaryColor: "#7638fa", // themeVars["--color-brand"] — the action color
    accentColor: "#146ef4", // themeVars["--color-health"] — the healthcare surface color
    heroFrom: hero.from,
    heroTo: hero.to,
    logoText: DEFAULT_TARGET.productName,
    fontChoice: "Inter",
  },
  business: {
    oneLiner:
      "AI voice agents that answer every patient call, so practices never miss a new patient again.",
    whatYouSell:
      "AI phone agents that answer, triage, and schedule patient calls directly into a practice's existing EHR, covering the front desk around the clock so no call goes unanswered.",
    icp: "Multi-location specialty medical practices (dermatology, women's health, ophthalmology, orthopedics) with high call volume and visible front-desk strain.",
    decisionMakerRoles: [
      "Practice Manager",
      "Practice Administrator",
      "COO",
      "Director of Operations",
      "Owner-Physician",
    ],
    geography: "United States, currently rotating across Austin TX, Tampa FL, and Charlotte NC.",
  },
  signals: [
    {
      name: "Front-desk staffing spike",
      kind: "staffing_spike",
      why: "A hiring burst for patient-coordinator/front-desk roles means the practice is understaffed on the exact job the product replaces, which is EliseAI's exact wedge.",
      dataSource: "Indeed / LinkedIn job posts (patient coordinator, front desk, call center)",
      freshnessDays: 30,
    },
    {
      name: "Phone-complaint reviews",
      kind: "phone_complaints",
      why: "Acute, self-reported phone pain in patients' own words is direct evidence the front desk is failing to answer, right now.",
      dataSource: "Google / Yelp / Healthgrades reviews (can't get through, on hold)",
      freshnessDays: 90,
    },
    {
      name: "Growth events",
      kind: "growth_events",
      why: "New volume outstrips the front desk, and multi-location consolidation drives tooling standardization.",
      dataSource: "PE deal news, site changes, Google Business updates, new provider bios",
      freshnessDays: 60,
    },
    {
      name: "Regulation deadline",
      kind: "regulation",
      why: "A dated compliance rule forces a buying moment on a fixed timeline.",
      dataSource: "CMS / payer prior-auth and interoperability rules with dates",
      freshnessDays: 180,
    },
  ],
  pitch: {
    painFit: derm.painFit.line,
    opener: {
      leadWith: derm.opener.leadWith,
      vocabulary: derm.opener.vocabulary,
      tone: derm.opener.tone,
      exampleOpener: derm.opener.exampleOpener,
    },
    discoveryQuestions: [
      "How are you covering the phones across all your locations today?",
      "Roughly how many new-patient calls do you think go unanswered on a busy day?",
      "Is capturing more new patients or reducing front-desk workload the bigger priority right now?",
    ],
    objections: [
      {
        q: "We just hired more front-desk staff.",
        rebuttal:
          "Makes sense, and this isn't a replacement for them, it's the layer that catches every call they can't get to, especially after hours and during peak season. Your team handles the complex conversations; the AI makes sure nothing rings out.",
      },
      {
        q: "Our patients want to talk to a real person.",
        rebuttal:
          "They still can. Anything clinical or complex routes straight to your team. What it removes is the hold music and the voicemail.",
      },
      {
        q: "We're already on an EHR for scheduling.",
        rebuttal:
          "Perfect, it writes straight into the schedule you already run. It's additive, not a rip-and-replace.",
      },
    ],
  },
  proof,
  sampleFeed: [],
});
