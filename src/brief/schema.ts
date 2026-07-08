import { z } from "zod";
import { PACK_VERTICALS } from "@/src/packs";

/**
 * The two-tier brief (U6, R4) as a TYPE, not a convention.
 *
 * ─── The line that runs through this whole file ───────────────────────────────
 *
 * **Stage 1 is code. Stage 2 is voice.** Factual fields — practice profile,
 * incumbent tooling, proof point, ROI range — are assembled deterministically from
 * evidence rows and pack data, each carrying the evidence id and source URL that
 * proves it. The LLM writes ONLY the prose: headline, opener, 3-touch sequence,
 * personalization, discovery questions, objection phrasing. The voice schema makes
 * this structural rather than aspirational: a voice field that asserts something
 * about the practice must name an evidence id from its own input, and
 * `citationClosure()` rejects the brief if it names one that was not supplied.
 *
 * A schema cannot check that prose is TRUE, only that it is ATTRIBUTED. The second
 * gate is `lint.ts`, which refuses any digit the evidence does not contain — the
 * one class of fabrication that actually reaches an AE's mouth on a call ("your
 * twelve locations", "you'll save 40%").
 *
 * ─── Why `value` is never rendered inside quotation marks ─────────────────────
 *
 * `src/enrich/citations.ts` splits verified facts into QUOTATION-class (the value
 * is copied out of the page: `yearFounded`, `ehr`) and LABEL-class (the value is
 * the model's own word for what the page says: `specialty`, `incumbentTooling`).
 * It reports the label ones in `VerificationResult.paraphrased` — and that report
 * is NOT persisted. A `practice_facts` row therefore cannot tell U6 which class it
 * belongs to.
 *
 * So the brief takes the only rule that is safe for both: **`Claim.value` renders
 * as plain text; `Claim.quote` is the page's own words and is the only field that
 * may appear in quotation marks.** This costs nothing — the card wants
 * "Specialty: Dermatology" with the sentence underneath — and it makes the
 * dangerous rendering unrepresentable rather than merely discouraged.
 */

// ─── Stage 1: factual (deterministic, assembled in code) ──────────────────────

/**
 * One cited factual atom, ready to render. `href` is the deepest link the evidence
 * supports — a scroll-to-text fragment landing on the exact sentence when we hold a
 * snippet, the bare page otherwise (`citation-link.ts`). Lilly's directive #1.
 */
export const claimSchema = z.object({
  /** Human label for the card row, e.g. "Specialty". Never an opaque field key. */
  label: z.string().min(1),
  /** Plain text. NEVER rendered inside quotation marks — see the file header. */
  value: z.string().min(1),
  /** The `evidence` row that proves it. The anchor of the whole citation contract. */
  evidenceId: z.uuid(),
  sourceUrl: z.url(),
  /** The page's own words. The ONLY field safe to render as a quotation. */
  quote: z.string().min(1).nullable(),
  /** Deep link: `sourceUrl` plus a text fragment when `quote` is present. */
  href: z.string().min(1),
});

export type Claim = z.infer<typeof claimSchema>;

/**
 * The pack's proof point, carried onto the card. `proof_pending` is a DELIBERATE,
 * valid state (U7) that renders "Proof pending — no customer success metrics found."
 * A silently blank proof fails pack validation long before it reaches here.
 */
export const proofPointCardSchema = z.discriminatedUnion("tag", [
  z.object({
    tag: z.literal("real"),
    caseStudy: z.string().min(1),
    metrics: z.array(z.string().min(1)).min(1),
    sourceUrl: z.url(),
    href: z.string().min(1),
  }),
  z.object({ tag: z.literal("proof_pending") }),
]);

export type ProofPointCard = z.infer<typeof proofPointCardSchema>;

/**
 * The ROI range. Tagged `modeled` — projected from public benchmarks, not measured
 * from this practice (D10's honesty tag). The tag is a literal, not a boolean, so
 * a card cannot render a modeled number as if it were measured.
 */
export const roiRangeCardSchema = z.object({
  tag: z.literal("modeled"),
  items: z
    .array(
      z.object({
        label: z.string().min(1),
        sourceUrl: z.url(),
        href: z.string().min(1),
      }),
    )
    .min(1),
});

export type RoiRangeCard = z.infer<typeof roiRangeCardSchema>;

/**
 * Who to contact. `role_only` is D9's honest degrade, and on the U5 cohort it was
 * the MAJORITY outcome (3 of 5 practices returned no named person) — so this is the
 * common path, not an edge case. `name` is null there, and nothing invents one.
 *
 * `linkedinHref` / `facebookHref` are the D7 deep-link buttons: we never scrape
 * mutual connections (that needs auth), we hand the AE a link and let LinkedIn
 * surface them at the top of the profile.
 */
export const contactCardSchema = z.object({
  variant: z.enum(["named", "role_only"]),
  name: z.string().min(1).nullable(),
  role: z.string().min(1),
  email: z.string().min(1).nullable(),
  /** Which half of the U5 waterfall supplied the email — the brief says where it came from. */
  emailProvider: z.enum(["claude_research", "pdl"]).nullable(),
  linkedinUrl: z.string().min(1).nullable(),
  bestChannel: z.string().min(1).nullable(),
  /** The page that named this person's role. Null only when the row predates provenance. */
  sourceUrl: z.string().min(1).nullable(),
  sourceHref: z.string().min(1).nullable(),
  /** Their profile if we hold one; otherwise a LinkedIn people-search for name + practice. */
  linkedinHref: z.string().min(1),
  facebookHref: z.string().min(1),
});

export type ContactCard = z.infer<typeof contactCardSchema>;

/**
 * The headline rendered when NO signal has fired (U8's zero-signal brief variant).
 * A constant, produced in code — the model is never asked to phrase the absence of
 * a buying moment, because the only way to phrase it wrongly is to invent one.
 */
export const ZERO_SIGNAL_HEADLINE = "No buying moment detected yet" as const;

/**
 * A generation-time snapshot of which signals were firing, as sorted
 * `"<kind>:<evidenceId>"` strings.
 *
 * NOT a render field. It exists so `isBriefStale()` can answer "have the signals
 * changed since this prose was written?" with a string compare instead of a
 * scheduler. The rendered signal count, fired-signal list, and freshness badge are
 * computed from the `signals` table at render time and never read from here (KTD:
 * "a stored brief can never claim '3 signals firing' after one has expired").
 */
export const signalFingerprintSchema = z.array(z.string().min(1));

export const factualBriefSchema = z.object({
  schemaVersion: z.number().int().positive(),
  vertical: z.enum(PACK_VERTICALS),
  practiceName: z.string().min(1),
  city: z.string().nullable(),
  state: z.string().nullable(),
  /** True when zero signals had fired at generation time. Drives the honest variant. */
  zeroSignal: z.boolean(),
  /** Set ONLY on the zero-signal variant; otherwise the voice supplies the headline. */
  headline: z.literal(ZERO_SIGNAL_HEADLINE).nullable(),
  profile: z.array(claimSchema),
  incumbentTooling: z.array(claimSchema),
  buyingMomentContext: z.array(claimSchema),
  /** Pack-authored voice, grounded in research but not itself a claim about THIS practice. */
  painFit: z.string().min(1),
  proofPoint: proofPointCardSchema,
  roiRange: roiRangeCardSchema,
  contact: contactCardSchema.nullable(),
  signalFingerprint: signalFingerprintSchema,
});

export type FactualBrief = z.infer<typeof factualBriefSchema>;

// ─── Stage 2: voice (the model writes prose, and only prose) ──────────────────

/**
 * Length caps are the mechanical half of Lilly's directives #2-#4 (friendly,
 * concise, skimmable). They live in zod, not in the JSON Schema handed to the API:
 * structured outputs support neither `minLength` nor `maxLength` (measured, E6), so
 * the API guarantees SHAPE and zod guarantees SIZE. `prompts/voice.ts` states the
 * same numbers to the model so the contract is satisfiable rather than a trap.
 *
 * A cap breach is a parse failure, which `synthesize.ts` feeds back into exactly one
 * retry. It is not silently truncated: a half-sentence in an AE's opener is worse
 * than no brief.
 */
export const VOICE_LIMITS = {
  headline: 90,
  callOpener: 320,
  personalizationSnippet: 240,
  touchSubject: 70,
  touchBody: 900,
  namedCta: 90,
  discoveryQuestion: 180,
  objection: 140,
  rebuttal: 340,
} as const;

/**
 * Evidence ids attached to a prose field. The model may only reference ids present
 * in its input; `citationClosure()` in `synthesize.ts` enforces it, and a violation
 * kills the brief rather than shipping an AE a claim traceable to nothing.
 */
const evidenceIds = z.array(z.uuid());

export const touchSchema = z.object({
  touchNumber: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  channel: z.enum(["email", "call", "linkedin"]),
  subject: z.string().min(1).max(VOICE_LIMITS.touchSubject),
  body: z.string().min(1).max(VOICE_LIMITS.touchBody),
  evidenceIds,
});

export type Touch = z.infer<typeof touchSchema>;

export const objectionSchema = z.object({
  objection: z.string().min(1).max(VOICE_LIMITS.objection),
  rebuttal: z.string().min(1).max(VOICE_LIMITS.rebuttal),
});

export type Objection = z.infer<typeof objectionSchema>;

/**
 * Exactly three touches, numbered 1-2-3 in order, plus ONE named next-step CTA
 * (D7's must-have add). "Exactly three" is the requirement; the ordering check is
 * what stops the model satisfying the count with `[1, 1, 3]`.
 */
export const sequenceSchema = z
  .object({
    touches: z.array(touchSchema).length(3),
    namedCta: z.string().min(1).max(VOICE_LIMITS.namedCta),
  })
  .superRefine((sequence, ctx) => {
    const numbers = sequence.touches.map((t) => t.touchNumber);
    if (numbers.join(",") !== "1,2,3") {
      ctx.addIssue({
        code: "custom",
        path: ["touches"],
        message: `touches must be numbered 1,2,3 in order (got ${numbers.join(",")})`,
      });
    }
  });

export type Sequence = z.infer<typeof sequenceSchema>;

/**
 * `headline` is nullable for exactly one reason: the zero-signal variant, where the
 * headline is the constant in `ZERO_SIGNAL_HEADLINE` and the model is instructed to
 * return null rather than phrase a buying moment that did not happen.
 *
 * `discoveryQuestions` and `objections` carry no evidence ids on purpose. A question
 * asserts nothing, and an objection is the PROSPECT's line, not ours. They are still
 * swept by the numeric-grounding lint — that is where an invented statistic would
 * hide, and it is the only place it could.
 */
export const voiceBriefSchema = z.object({
  headline: z.string().min(1).max(VOICE_LIMITS.headline).nullable(),
  headlineEvidenceIds: evidenceIds,
  callOpener: z.string().min(1).max(VOICE_LIMITS.callOpener),
  callOpenerEvidenceIds: evidenceIds,
  personalizationSnippet: z
    .string()
    .min(1)
    .max(VOICE_LIMITS.personalizationSnippet),
  personalizationEvidenceIds: evidenceIds,
  sequence: sequenceSchema,
  discoveryQuestions: z
    .array(z.string().min(1).max(VOICE_LIMITS.discoveryQuestion))
    .min(2)
    .max(3),
  objections: z.array(objectionSchema).length(3),
});

export type VoiceBrief = z.infer<typeof voiceBriefSchema>;

/** Every evidence id the model attached to a prose field, in a stable order. */
export function referencedEvidenceIds(voice: VoiceBrief): string[] {
  return [
    ...voice.headlineEvidenceIds,
    ...voice.callOpenerEvidenceIds,
    ...voice.personalizationEvidenceIds,
    ...voice.sequence.touches.flatMap((touch) => touch.evidenceIds),
  ];
}

/** Every string of model-authored prose. What `lint.ts` sweeps for ungrounded digits. */
export function voiceProse(voice: VoiceBrief): string[] {
  return [
    ...(voice.headline === null ? [] : [voice.headline]),
    voice.callOpener,
    voice.personalizationSnippet,
    ...voice.sequence.touches.flatMap((touch) => [touch.subject, touch.body]),
    voice.sequence.namedCta,
    ...voice.discoveryQuestions,
    ...voice.objections.flatMap((o) => [o.objection, o.rebuttal]),
  ];
}

// ─── The persisted row + the render-time view ─────────────────────────────────

/** What lands in `briefs.factual` / `briefs.voice`. Time-sensitive fields are absent by design. */
export interface StoredBrief {
  factual: FactualBrief;
  voice: VoiceBrief;
}

export type ParseVoiceResult =
  | { ok: true; voice: VoiceBrief }
  | { ok: false; reason: string };

/**
 * Parse + validate the model's voice output. Never throws.
 *
 * Mirrors `parseResearchOutput`: the paid call has already happened by the time we
 * get here, so a malformed body is a RESULT (which `synthesize.ts` can retry with
 * the reason attached), never an exception that unwinds past the cost meter.
 *
 * Structured outputs return bare JSON, so there is no prose to scan past — but a
 * `max_tokens` truncation still yields syntactically incomplete JSON, and
 * `JSON.parse`'s own syntax error is the most informative thing we can report.
 */
export function parseVoiceOutput(text: string): ParseVoiceResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: `malformed JSON: ${message}` };
  }

  const parsed = voiceBriefSchema.safeParse(raw);
  if (parsed.success) return { ok: true, voice: parsed.data };

  const reason = parsed.error.issues
    .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("; ");
  return { ok: false, reason };
}
