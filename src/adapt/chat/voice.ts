import type { DraftWorkspaceConfig } from "@/src/adapt/schema";

/**
 * The Adapter's voice for the conversational onboarding (`/adapt/chat`).
 *
 * Every connective line is CRAFTED here and interpolates the AI-generated values
 * (company, ICP, signal names, product name, brand color). Hardcoding the copy
 * keeps each turn instant and on-voice: the only real waits in the flow are the
 * two backend calls (`/api/adapt/generate`, `/api/adapt/finalize`). The Adapter
 * reads as a sharp operator who got the business on the first pass, not a chatbot.
 *
 * Pure and dependency-free, so the reducer in `./machine.ts` can build the exact
 * message stream deterministically and a test can assert every line is free of the
 * AI tells (`tests/adapt/chat-machine.test.ts`).
 */

export type BrandPatch = Pick<
  DraftWorkspaceConfig["brand"],
  "primaryColor" | "accentColor" | "heroFrom" | "heroTo"
>;

/** What the user types on the opening turn, held for the studying line. */
export interface IntroInput {
  companyName: string;
  whatYouSell: string;
  websiteUrl: string | null;
}

// ─── Small text helpers ───────────────────────────────────────────────────────

/** Capitalize the first letter and guarantee one terminal sentence mark. */
function asSentence(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) return trimmed;
  const capped = trimmed[0].toUpperCase() + trimmed.slice(1);
  return /[.!?]$/.test(capped) ? capped : `${capped}.`;
}

const NUMBER_WORDS = ["zero", "one", "two", "three", "four", "five", "six"];

function numberWord(n: number): string {
  return NUMBER_WORDS[n] ?? String(n);
}

/** Join a short list with commas and a trailing "and". */
function humanizeList(items: string[]): string {
  const parts = items.map((s) => s.trim()).filter((s) => s.length > 0);
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
}

// ─── Color naming (for the brand line + swatch labels) ────────────────────────

function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const clean = hex.replace("#", "");
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return { h: h * 60, s, l };
}

/** A plain, single-word color name from a hex, for "paint it teal." */
export function colorName(hex: string): string {
  const { h, s } = hexToHsl(hex);
  if (s < 0.12) return "slate";
  if (h < 16) return "red";
  if (h < 45) return "amber";
  if (h < 66) return "gold";
  if (h < 168) return "green";
  if (h < 192) return "teal";
  if (h < 205) return "cyan";
  if (h < 240) return "blue";
  if (h < 280) return "indigo";
  if (h < 320) return "violet";
  if (h < 344) return "magenta";
  return "rose";
}

// ─── Brand swatches for the brand turn ────────────────────────────────────────

/**
 * A small, curated set of full brand patches for the inline color swatches. Every
 * value is a valid six-digit hex, so the derived `brandVars` ramp always builds.
 * The AI's own pick leads; a few tasteful alternates follow (deduped by hue).
 */
const CURATED_SWATCHES: readonly BrandPatch[] = [
  { primaryColor: "#0d9488", accentColor: "#2563eb", heroFrom: "#0f766e", heroTo: "#99f6e4" },
  { primaryColor: "#4f46e5", accentColor: "#0ea5e9", heroFrom: "#3730a3", heroTo: "#a5b4fc" },
  { primaryColor: "#2f5fe0", accentColor: "#0e9f6e", heroFrom: "#1e3a8a", heroTo: "#93c5fd" },
  { primaryColor: "#e11d48", accentColor: "#7c3aed", heroFrom: "#9f1239", heroTo: "#fda4af" },
  { primaryColor: "#ea580c", accentColor: "#0891b2", heroFrom: "#9a3412", heroTo: "#fdba74" },
  { primaryColor: "#7c3aed", accentColor: "#0ea5e9", heroFrom: "#5b21b6", heroTo: "#c4b5fd" },
];

export interface BrandSwatch {
  id: string;
  colorName: string;
  patch: BrandPatch;
  /** True for the Adapter's own pick, shown first. */
  isPick: boolean;
}

/** The AI's pick first, then up to three alternates whose hue name differs from it. */
export function brandSwatches(draft: DraftWorkspaceConfig): BrandSwatch[] {
  const pickName = colorName(draft.brand.primaryColor);
  const pick: BrandSwatch = {
    id: "pick",
    colorName: pickName,
    isPick: true,
    patch: {
      primaryColor: draft.brand.primaryColor,
      accentColor: draft.brand.accentColor,
      heroFrom: draft.brand.heroFrom,
      heroTo: draft.brand.heroTo,
    },
  };
  const seen = new Set([pickName]);
  const alternates: BrandSwatch[] = [];
  for (const patch of CURATED_SWATCHES) {
    const name = colorName(patch.primaryColor);
    if (seen.has(name)) continue;
    seen.add(name);
    alternates.push({ id: `alt-${name}`, colorName: name, patch, isPick: false });
    if (alternates.length >= 3) break;
  }
  return [pick, ...alternates];
}

// ─── The Adapter's crafted lines ──────────────────────────────────────────────

/** The two opening turns, seeded before any AI value exists. */
export const OPENER_TURNS: readonly string[] = [
  "I'm the Adapter. I set this engine up around your business while we talk.",
  "Start me with two things: your company, and what you sell.",
];

function studyingLine(intro: IntroInput): string {
  const company = intro.companyName.trim() || "Your company";
  const sell = asSentence(intro.whatYouSell);
  return `${company}. ${sell} I know this space. Give me a moment to build it.`;
}

function audienceLine(draft: DraftWorkspaceConfig): string {
  const roles = humanizeList(draft.business.decisionMakerRoles.slice(0, 3));
  if (roles.length === 0) return "Here's who buys this. The people who feel the problem first.";
  return `Here's who buys this: ${roles}.`;
}

function signalsLine(draft: DraftWorkspaceConfig): string {
  const n = draft.signals.length;
  if (n === 1) return "One moment worth watching. It's the tell that a buy is coming.";
  const word = numberWord(n);
  const count = word.charAt(0).toUpperCase() + word.slice(1);
  return `${count} moments worth watching. They're the tells that a buy is coming.`;
}

function proofAskLine(): string {
  return "Now the proof. What's the best result you've gotten for a customer? One line is plenty.";
}

function brandLine(draft: DraftWorkspaceConfig): string {
  return `I'll call it ${draft.brand.productName} and paint it ${colorName(
    draft.brand.primaryColor,
  )}.`;
}

function buildingLine(): string {
  return "Writing your first three briefs. Give me a few seconds.";
}

function doneLine(draft: DraftWorkspaceConfig): string {
  return `That's your engine, ${draft.brand.companyName}. Open it up.`;
}

/**
 * The Adapter's line for a phase that speaks, or `null` for a phase that doesn't
 * (the opening turns are seeded separately). The reducer calls this on `SPEAK`.
 */
export function adapterLineFor(
  phase: string,
  ctx: { intro: IntroInput | null; draft: DraftWorkspaceConfig | null },
): string | null {
  switch (phase) {
    case "generating":
      return ctx.intro ? studyingLine(ctx.intro) : null;
    case "audience":
      return ctx.draft ? audienceLine(ctx.draft) : null;
    case "signals":
      return ctx.draft ? signalsLine(ctx.draft) : null;
    case "proof":
      return proofAskLine();
    case "brand":
      return ctx.draft ? brandLine(ctx.draft) : null;
    case "finalizing":
      return buildingLine();
    case "done":
      return ctx.draft ? doneLine(ctx.draft) : null;
    default:
      return null;
  }
}
