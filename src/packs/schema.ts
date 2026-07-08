import { z } from "zod";

/**
 * Vertical pack schema (U7/R6) — "one engine, four pitches": a shared engine +
 * brief frame, where a vertical is a different PITCH, not a different product.
 * Every pack is EXACTLY five variables, in spec order:
 *   1. painFit      — pain + EliseAI-fit line (authored voice)
 *   2. opener        — opener language & tone (authored voice)
 *   3. proofPoint    — ONE real, citable case study, or `proof_pending` (R5)
 *   4. ehrSignals    — which EHR(s) flag this vertical
 *   5. roiBenchmark  — call-volume/no-show/appt-value inputs, tagged `modeled`
 *
 * Variables 1-2 are authored voice — grounded in the research but not
 * themselves factual claims, so they carry no citation requirement. Variables
 * 3-5 are claims and MUST carry a source URL (R5: every proof point carries a
 * citation).
 *
 * `vertical` mirrors the DB `vertical` pgEnum values used elsewhere in the
 * repo (db/schema/entities.ts) as a plain string union, minus its
 * `unclassified` placeholder value — packs stay pure data with NO DB import.
 */

export const PACK_VERTICALS = [
  "dermatology",
  "womens_health",
  "ophthalmology",
  "orthopedics",
] as const;

export type PackVertical = (typeof PACK_VERTICALS)[number];

/** 1. Pain + EliseAI-fit line — the sharpest version of this specialty's front-desk/phone pain. */
const painFitSchema = z.object({
  line: z.string().min(1),
  /** Where the line is grounded (research citation prose) — informational, not a validated claim. */
  grounding: z.string().min(1),
});

/** 2. Opener language & tone — vocabulary + what the opener leads with. */
const openerSchema = z.object({
  leadWith: z.string().min(1),
  vocabulary: z.array(z.string().min(1)).min(1),
  tone: z.string().min(1),
  exampleOpener: z.string().min(1),
});

/**
 * 3. Proof point — ONE real, citable EliseAI case study WITH its source URL
 * (tag `real`), or the explicit `proof_pending` sentinel: a deliberate, valid
 * state that the UI renders as "Proof pending — no customer success metrics
 * found." A silently blank/empty proof (empty string, null, an object missing
 * its URL) matches NEITHER union member and fails — only the explicit
 * sentinel is allowed to stand in for "no proof yet," so no pack ever ships
 * an accidentally-blank proof.
 */
const realProofPointSchema = z.object({
  tag: z.literal("real"),
  caseStudy: z.string().min(1),
  metrics: z.array(z.string().min(1)).min(1),
  sourceUrl: z.url(),
});

const proofPendingSchema = z.object({
  tag: z.literal("proof_pending"),
});

const proofPointSchema = z.discriminatedUnion("tag", [
  realProofPointSchema,
  proofPendingSchema,
]);

export type ProofPoint = z.infer<typeof proofPointSchema>;

/** 4. EHR-as-signal — which EHR(s) flag this vertical, each ideally with a source URL. */
const ehrSignalSchema = z.object({
  name: z.string().min(1),
  sourceUrl: z.url().optional(),
});

/**
 * 5. ROI benchmark — specialty call-volume / no-show rate / appointment-value
 * inputs feeding the ROI number, tagged `modeled`, each with its public
 * source URL.
 */
const roiBenchmarkItemSchema = z.object({
  label: z.string().min(1),
  sourceUrl: z.url(),
});

const roiBenchmarkSchema = z.object({
  tag: z.literal("modeled"),
  items: z.array(roiBenchmarkItemSchema).min(1),
});

export const packSchema = z.object({
  vertical: z.enum(PACK_VERTICALS),
  painFit: painFitSchema,
  opener: openerSchema,
  proofPoint: proofPointSchema,
  ehrSignals: z.array(ehrSignalSchema).min(1),
  roiBenchmark: roiBenchmarkSchema,
});

export type PackInput = z.input<typeof packSchema>;
export type VerticalPack = z.output<typeof packSchema>;
