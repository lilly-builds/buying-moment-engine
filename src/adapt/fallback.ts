import type { WorkspaceConfig } from "@/src/workspace/schema";
import { joinClaimMetric } from "./proof-format";
import {
  SampleFeedSchema,
  type DraftWorkspaceConfig,
  type GenerateInput,
  type SampleFeed,
} from "./schema";

/**
 * Deterministic templates so the onboarding NEVER dead-ends. Every Claude call in
 * Phase 3 falls back here on any failure (network, timeout, bad JSON, invalid
 * shape), so `/api/adapt/generate` and `/api/adapt/finalize` always return a
 * schema-valid result to the browser. These are derived from the user's own
 * inputs (and, for the feed, the confirmed config), so the fallback still feels
 * like theirs rather than a stock demo.
 */

/** Trim to a max length so a fallback string can never breach a schema cap. */
function clamp(value: string, max: number): string {
  const trimmed = value.trim();
  return trimmed.length <= max ? trimmed : trimmed.slice(0, max);
}

/** A tiny, stable string hash — used to pick a palette deterministically. */
function hash(value: string): number {
  let h = 0;
  for (let i = 0; i < value.length; i++) {
    h = (h * 31 + value.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

/** The first word of a company name, for a wordmark. Falls back to the whole. */
function firstWord(name: string): string {
  const word = name.trim().split(/\s+/)[0];
  return word && word.length > 0 ? word : name.trim();
}

/**
 * Tasteful, industry-neutral palettes — deliberately NOT EliseAI purple. One is
 * chosen by a hash of the company name, so two different businesses land on
 * different (but stable) brands even when both fall back. Every value is a valid
 * lowercase six-digit hex, so the derived `brandVars` ramp always builds.
 */
interface Palette {
  primaryColor: string;
  accentColor: string;
  heroFrom: string;
  heroTo: string;
}

const PALETTES: readonly Palette[] = [
  { primaryColor: "#2f5fe0", accentColor: "#0e9f6e", heroFrom: "#1e3a8a", heroTo: "#93c5fd" },
  { primaryColor: "#0d9488", accentColor: "#2563eb", heroFrom: "#0f766e", heroTo: "#99f6e4" },
  { primaryColor: "#4f46e5", accentColor: "#0ea5e9", heroFrom: "#3730a3", heroTo: "#a5b4fc" },
  { primaryColor: "#059669", accentColor: "#0891b2", heroFrom: "#047857", heroTo: "#6ee7b7" },
  { primaryColor: "#ea580c", accentColor: "#0891b2", heroFrom: "#9a3412", heroTo: "#fdba74" },
  { primaryColor: "#e11d48", accentColor: "#7c3aed", heroFrom: "#9f1239", heroTo: "#fda4af" },
];

export function fallbackPalette(seed: string): Palette {
  return PALETTES[hash(seed) % PALETTES.length];
}

/**
 * A smart deterministic draft config derived from the two inputs. Generic B2B
 * buying-moment signals (hiring surge, growth/funding, new leader) that apply to
 * almost any business, plus a plain, honest pitch and a pending proof point.
 */
export function buildFallbackDraft(input: GenerateInput): DraftWorkspaceConfig {
  const company = clamp(input.companyName, 80) || "Your company";
  const sell = clamp(input.whatYouSell, 2000) || "your product";
  const mark = clamp(`${firstWord(company)} Signals`, 40);
  const palette = fallbackPalette(company);

  return {
    brand: {
      productName: mark,
      companyName: company,
      primaryColor: palette.primaryColor,
      accentColor: palette.accentColor,
      heroFrom: palette.heroFrom,
      heroTo: palette.heroTo,
      logoText: mark,
      fontChoice: "inter",
    },
    business: {
      oneLiner: clamp(`${company} helps its customers with ${sell}.`, 200),
      whatYouSell: sell,
      icp: clamp(
        `Businesses that would benefit from ${sell} and have budget to act when the timing is right.`,
        500,
      ),
      decisionMakerRoles: ["Founder", "Owner", "VP of Sales", "Head of Operations"],
      geography: "United States",
    },
    signals: [
      {
        name: "Hiring surge in a related role",
        kind: "hiring_surge",
        why: "When a company staffs up in the area your product serves, a budget just opened and the pain is top of mind.",
        dataSource: "Public job boards (LinkedIn, Indeed, company careers pages)",
        freshnessDays: 30,
      },
      {
        name: "Funding or growth event",
        kind: "growth_event",
        why: "A raise, an acquisition, or a new location means fresh budget and a mandate to scale, which is exactly when new tools get bought.",
        dataSource: "Funding databases, press releases, and business news",
        freshnessDays: 60,
      },
      {
        name: "New leader in a buying role",
        kind: "leadership_change",
        why: "A new executive wants an early, visible win, so they are unusually open to a better way of doing things in their first few months.",
        dataSource: "LinkedIn and company announcements",
        freshnessDays: 90,
      },
    ],
    pitch: {
      painFit: clamp(
        `Teams that buy ${sell} usually feel the pain as wasted time, missed revenue, or manual work that does not scale.`,
        1000,
      ),
      opener: {
        leadWith: "Open on the change happening at their company, not on your product.",
        vocabulary: ["timing", "budget", "scale", "team", "growth"],
        tone: "Warm, direct, and specific. Sound like a peer who did the homework.",
        exampleOpener:
          "I noticed your team is growing fast right now, which usually strains the old way of handling this. Is that landing for you?",
      },
      discoveryQuestions: [
        "How are you handling this today, and where does it break down?",
        "What changed recently that put this on your list?",
        "If this were solved, what would it free your team up to do?",
      ],
      objections: [
        {
          q: "We already have a way to handle this.",
          rebuttal:
            "That makes sense, and this is not a rip and replace. It sits on top of what you have and catches what falls through, especially as you grow.",
        },
        {
          q: "Now is not a great time.",
          rebuttal:
            "Fair, and most teams reach out right when things get busy, because that is when the manual way starts to cost real money. A short look now saves the scramble later.",
        },
      ],
    },
    proof: [{ claim: clamp(`${company} customer results`, 300), tag: "pending" }],
  };
}

// ─── Fallback sample feed ─────────────────────────────────────────────────────

/** Fictional, clearly-synthetic prospect names. Never a real company. */
const SAMPLE_NAMES = ["Northwind Trading Co.", "Cedar & Vale", "Brightline Labs"];
const SAMPLE_CONTACTS = [
  { name: "Jordan Ellis", channel: "Email" },
  { name: "Priya Nair", channel: "LinkedIn" },
  { name: "Marcus Bell", channel: "Email" },
];
const SAMPLE_FRESHNESS = ["Fresh today", "2 days ago", "This week"];

/**
 * Three deterministic sample prospects built from the confirmed config: each
 * fires one of the tenant's own signals and carries a brief drawn from their own
 * pitch, so the fallback feed still reads in their voice. Always exactly three,
 * always schema-valid.
 */
export function buildFallbackSampleFeed(config: DraftWorkspaceConfig): SampleFeed {
  const { business, pitch, signals, proof } = config;
  const role = business.decisionMakerRoles[0] ?? "Decision maker";
  // `painFit` is min(1) in the schema, but a draft could carry a whitespace-only
  // value that `clamp`'s trim empties; default so the feed is always non-empty.
  const painFit =
    clamp(pitch.painFit, 1000) || "They feel the pain now, and the timing is finally right.";
  const proofPoint = proof[0];
  const proofLine =
    proofPoint && "metric" in proofPoint
      ? clamp(joinClaimMetric(proofPoint.claim, proofPoint.metric), 300)
      : "Early customers see the value once the timing is right. Yours coming soon.";
  const discoveryQuestions =
    pitch.discoveryQuestions.length > 0
      ? pitch.discoveryQuestions.slice(0, 3).map((q) => clamp(q, 300))
      : ["What changed recently that put this on your list?"];
  const objections =
    pitch.objections.length > 0
      ? pitch.objections.slice(0, 3).map((o) => ({
          q: clamp(o.q, 300),
          rebuttal: clamp(o.rebuttal, 1000),
        }))
      : [{ q: "Now is not a great time.", rebuttal: "Fair, and that is usually exactly when it starts to cost real money." }];

  const prospects = SAMPLE_NAMES.map((name, i) => {
    const signal = signals[i % signals.length];
    const contact = SAMPLE_CONTACTS[i % SAMPLE_CONTACTS.length];
    return {
      id: `sample-${i + 1}`,
      name: clamp(name, 120),
      oneLine: clamp(`A company that matches your ideal customer profile.`, 300),
      headline: clamp(`Just hit a buying moment: ${signal.name.toLowerCase()}.`, 200),
      freshnessLabel: clamp(SAMPLE_FRESHNESS[i % SAMPLE_FRESHNESS.length], 60),
      signals: [{ name: clamp(signal.name, 120), kind: clamp(signal.kind, 60) }],
      brief: {
        whoToContact: {
          name: clamp(contact.name, 120),
          role: clamp(role, 120),
          channel: clamp(contact.channel, 60),
          personalization: clamp(
            `Open on the ${signal.name.toLowerCase()} you spotted, not on your product.`,
            500,
          ),
        },
        recommendedAction: clamp(
          `Send a short, specific note about the ${signal.name.toLowerCase()}.`,
          300,
        ),
        painFit,
        proofLine,
        discoveryQuestions,
        objections,
      },
    };
  });
  // Prove the invariant rather than assert it: the deterministic feed is ALWAYS
  // schema-valid, so `createWorkspace` can never reject the fallback path.
  return SampleFeedSchema.parse(prospects);
}

/** Slugify a company/product name for the workspace URL key. Never empty. */
export function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return slug.length > 0 ? slug : "workspace";
}

/** Re-export so callers can spread the draft + a generated feed into a full config. */
export type { WorkspaceConfig };
