import type { ContactRow, FactRow, SignalRow } from "../inputs";
import { AI_TELLS, MAX_EM_DASHES_PER_FIELD, MAX_SENTENCE_WORDS } from "../lint";
import { VOICE_LIMITS } from "../schema";
import type { VerticalPack } from "@/src/packs";
import type { PackVertical } from "@/src/packs";

/**
 * The voice prompt AND the JSON Schema that constrains its output. They live together
 * because they are one contract: change the shape in one and the other is a lie.
 * `parseVoiceOutput` (zod) then re-checks the result — **the API guarantees SHAPE,
 * never TRUTH**, and `lint.ts` guarantees no number arrived from nowhere.
 *
 * ─── The banned-phrase list is imported, not retyped ──────────────────────────
 *
 * `AI_TELLS`, `MAX_SENTENCE_WORDS`, `MAX_EM_DASHES_PER_FIELD` and `VOICE_LIMITS` are
 * interpolated from the modules that ENFORCE them. A prompt that asks for one thing
 * while the lint rejects another is a retry loop that never converges, and it is the
 * single easiest bug to write here. There is one source of truth per rule.
 *
 * ─── On the selling craft, and what is and is not being claimed ───────────────
 *
 * Lilly asked for "timeless sales principles from the greats — like Forbes Riley &
 * Tony Robbins — so the Claude part sounds effective, and not like classic AI writing."
 *
 * What follows is a distillation of the direct-response and consultative-selling
 * tradition those names point at: Riley's pitch structure (passion; identify the
 * problem; TEACH something the listener did not know; ONE call to action; hold their
 * attention), and Robbins' framing (enter the other person's world before you ask for
 * anything; a better question beats a better assertion; specificity is what produces
 * certainty). **No quotation is asserted and none is used.** These are craft rules, not
 * facts the brief states — the brief's factual claims all live in Stage 1 and carry
 * evidence ids. Attribution here is directional, and it is labelled that way on purpose:
 * this repo's rule is that an unverified claim is never dressed as a verified one, and
 * that rule does not stop applying inside a prompt.
 *
 * The rules below are what those principles cash out to for an AE emailing a practice
 * manager who has read a hundred cold emails this year.
 */

export const VOICE_SYSTEM_PROMPT = `You write the human half of a sales brief. An Account Executive at EliseAI opens it thirty seconds before dialling a medical practice, and reads it standing up.

EliseAI answers a practice's phones, books appointments, and handles patient messages, so the front desk stops losing calls.

You are given EVIDENCE: a set of facts, each with an id, gathered from the practice's own public pages and from public hiring/review/news sources. You are also given a VERTICAL PACK: authored positioning for this specialty.

HARD RULES — these are constraints, not preferences. A brief that breaks one is discarded.
1. Every fact you state must come from the EVIDENCE. Never use prior knowledge about this practice. Never infer, estimate, or round.
2. When a field asks for "evidenceIds", list the ids of the EVIDENCE items your sentence relies on. Use the ids exactly as given. Never invent an id. Never cite an id for a sentence it does not support.
3. NUMBERS. Never write a number that does not appear, digit for digit, in the EVIDENCE — and never spell one out to get around this (no "forty percent", no "thirty seconds"). If you want to say a number and cannot find it, say it without the number. Write "around the clock", never "24/7". Write "most calls", never "80% of calls". Never quantify the EVIDENCE, even vaguely: if it is one review, write "a patient wrote", never "a couple of patients" or "several patients". The VERTICAL PACK is positioning drawn from OTHER practices and market data, so EVERY number anywhere in it — its pain line, its tone-reference example, its proof point, its ROI benchmarks — is another practice's, never this one's. You may state a pack number ONLY inside an objection rebuttal; in the headline, the opener, and every touch, make the point without the number. The tone reference shows sentence RHYTHM only — never reuse its words or its numbers.
4. Never state how many signals are firing, and never count anything. Those change after you write; the dashboard renders them live.
5. ABSENCE IS ABSENCE. If the EVIDENCE does not name the person, do not name a person. If it does not name their EHR, do not name an EHR. Omit it. An empty section is honest; a guessed one ends the call.
6. Do not write an email address, a phone number, or a URL into any sentence.
7. Plain text only. No markdown, no bullet characters, no emoji, no headers. At most ${MAX_EM_DASHES_PER_FIELD} em dashes in any one field.
8. No sentence longer than ${MAX_SENTENCE_WORDS} words. Write the way you speak. Contractions are good.

HOW TO SELL — this is the difference between a brief an AE uses and one they rewrite.
- OPEN IN THEIR WORLD. The first sentence is about them, never about us and never about you. Do not start a message with "I". Start with what is happening at their front desk.
- NAME THE PAIN BETTER THAN THEY CAN. Use the pack's vocabulary. When you describe their problem more precisely than they would, you have earned the next sentence.
- TEACH ONE THING. Every message must hand them something they did not know when they opened it: a pattern, a consequence, a sharp observation about their world. Reach for an insight, not a number — the pack's figures already appear on the card, and a number in the prose is almost always one the evidence cannot support. If a message teaches nothing, it is a follow-up nobody answers.
- SPECIFIC BEATS GENERAL. One real detail from the evidence outperforms every adjective. Certainty comes from specificity, never from intensity. Delete every word that survives without changing the meaning.
- QUESTIONS BEAT ASSERTIONS. A question about their world gets a reply. A claim about our product gets deleted.
- ONE ASK. Exactly one call to action, and it is small, named, and easy to say yes to. Never stack two asks.
- MAKE IT EASY TO SAY NO. The last touch gives them a graceful exit. Pressure loses the account and the referral.
- NO HYPE. No superlatives, no promises, no exclamation marks.

THE THREE TOUCHES.
- Touch 1 (email): the buying moment, one specific observation from the EVIDENCE, and the named CTA. Under six sentences.
- Touch 2 (call or email): teach. Lead with what the proof point shows — the story, not its figures, which belong only in a rebuttal — or with a discovery question. Do not repeat touch 1's pitch.
- Touch 3 (email): the graceful close. Short. Offer the exit. Leave the door open.

THE OTHER FIELDS.
- headline: the buying moment in plain words, as a person would say it out loud. No count, no signal names, no colon-separated label.
- callOpener: what the AE says in the first ten seconds of the call. Their world first.
- personalizationSnippet: the one specific, human detail that proves we actually looked. From the EVIDENCE, never from the pack.
- discoveryQuestions: 2 or 3. Open-ended, about their operations, impossible to answer with yes or no.
- objections: the three things this prospect actually says, in their words, short. Each rebuttal agrees first, then reframes, then points at the pack's proof. Objections and rebuttals must contain no numbers unless the pack's proof supplies them.

BANNED PHRASES — every one of these marks the writing as machine-made or as filler. Do not use them in any form:
${AI_TELLS.map((tell) => `"${tell}"`).join(", ")}.

LENGTH CEILINGS, in characters. Going over discards the brief.
headline ${VOICE_LIMITS.headline}; callOpener ${VOICE_LIMITS.callOpener}; personalizationSnippet ${VOICE_LIMITS.personalizationSnippet}; each touch subject ${VOICE_LIMITS.touchSubject}; each touch body ${VOICE_LIMITS.touchBody}; namedCta ${VOICE_LIMITS.namedCta}; each discoveryQuestion ${VOICE_LIMITS.discoveryQuestion}; each objection ${VOICE_LIMITS.objection}; each rebuttal ${VOICE_LIMITS.rebuttal}.

Return the JSON object and nothing else.`;

/**
 * The zero-signal instruction. A practice reached by pull-mode with no fired signal has
 * no buying moment, so the model is told to return `headline: null` — the card renders
 * the constant `ZERO_SIGNAL_HEADLINE` instead. The one way to get this wrong is to let
 * a model phrase the absence of urgency, because the only phrasings available to it are
 * inventions.
 */
const ZERO_SIGNAL_INSTRUCTION = `NO BUYING MOMENT HAS FIRED for this practice.
Set "headline" to null. Do not invent urgency, a trigger, or a reason to call today.
Write the opener and the sequence around the practice profile and the pack's pain line only.
Touch 1 opens on the specialty's known problem, not on anything specific having just happened.`;

const SIGNAL_INSTRUCTION = `A BUYING MOMENT HAS FIRED. Write "headline" as the buying moment.
Cite at least one signal evidence id in "headlineEvidenceIds".`;

function formatEvidenceLine(
  id: string,
  kind: string,
  claim: string,
  sourceUrl: string,
  snippet: string | null,
): string {
  const lines = [`[${id}] ${kind}`, `  claim: ${claim}`, `  source: ${sourceUrl}`];
  if (snippet) lines.push(`  page says: "${snippet}"`);
  return lines.join("\n");
}

/**
 * Human names for the machine field keys, so the model reads "the practice's specialty"
 * rather than `specialty`, and reads the indexed families as what they are.
 */
function describeFact(fact: FactRow): string {
  if (fact.field.startsWith("incumbent_tooling_")) return "FACT: incumbent tooling";
  if (fact.field.startsWith("buying_moment_")) return "FACT: buying-moment context";
  if (fact.field === "ehr") return "FACT: EHR";
  return `FACT: ${fact.field}`;
}

const SIGNAL_MEANING: Record<string, string> = {
  staffing_spike: "they are hiring front-desk / phone staff",
  phone_complaints: "patients publicly complain they cannot get through",
  growth_events: "they are growing (new location, deal, or provider)",
  regulation: "a dated regulation forces a decision",
};

export interface VoiceRequest {
  practice: {
    id: string;
    name: string;
    city: string | null;
    state: string | null;
    vertical: PackVertical;
  };
  facts: FactRow[];
  /** Already filtered to the FRESH set by `assembleFactual`. A stale signal is not a moment. */
  signals: SignalRow[];
  contact: ContactRow | null;
  pack: VerticalPack;
  zeroSignal: boolean;
  /**
   * Violations from the previous attempt. Appended as a correction block on a FRESH
   * single-turn request rather than sent as a follow-up conversation turn — a multi-turn
   * retry would have to echo the assistant's thinking blocks back unchanged, and dropping
   * them risks a 400 on this model. One turn, no replay, and the cached prefix survives.
   */
  corrections?: readonly string[];
}

/**
 * The EVIDENCE block IS the citation namespace. The model is physically unable to cite
 * an id it was not handed, because no other id appears anywhere in its context — and
 * `citationClosure()` then checks it did not invent one anyway.
 */
export function buildVoicePrompt(request: VoiceRequest): string {
  const location = [request.practice.city, request.practice.state].filter(Boolean).join(", ");
  const pack = request.pack;

  const evidence = [
    ...request.signals.map((signal) =>
      formatEvidenceLine(
        signal.evidence.id,
        `SIGNAL: ${signal.kind} — ${SIGNAL_MEANING[signal.kind] ?? signal.kind}`,
        `detected ${signal.detectedAt.toISOString().slice(0, 10)}`,
        signal.evidence.sourceUrl,
        signal.evidence.snippet,
      ),
    ),
    ...request.facts.map((fact) =>
      formatEvidenceLine(
        fact.evidence.id,
        describeFact(fact),
        fact.value,
        fact.evidence.sourceUrl,
        fact.evidence.snippet,
      ),
    ),
  ];

  const proof =
    pack.proofPoint.tag === "real"
      ? [
          `proof point — ${pack.proofPoint.caseStudy}'s results (quote these FIGURES only inside an objection rebuttal; elsewhere say what they show, no numbers):`,
          ...pack.proofPoint.metrics.map((m) => `  - ${m}`),
        ]
      : ["proof point: none published yet — do not invent one, and do not imply one"];

  const contact = request.contact
    ? [
        `role: ${request.contact.role}`,
        request.contact.name ? `name: ${request.contact.name}` : "name: unknown — address the role, never a guessed name",
      ]
    : ["no contact resolved — write to the role you would expect at a practice this size, and name no one"];

  return [
    `PRACTICE: ${request.practice.name}${location ? ` (${location})` : ""}`,
    `SPECIALTY: ${request.practice.vertical}`,
    "",
    request.zeroSignal ? ZERO_SIGNAL_INSTRUCTION : SIGNAL_INSTRUCTION,
    "",
    "=== EVIDENCE — the only facts you may use, and the only ids you may cite ===",
    evidence.length > 0 ? evidence.join("\n\n") : "(none — say nothing specific about this practice)",
    "",
    "=== VERTICAL PACK — positioning, not evidence. Never cite an id for these. ===",
    `pain: ${pack.painFit.line}`,
    `lead with: ${pack.opener.leadWith}`,
    `their vocabulary: ${pack.opener.vocabulary.join("; ")}`,
    `tone: ${pack.opener.tone}`,
    `tone reference — RHYTHM ONLY, never reuse its words or numbers: ${pack.opener.exampleOpener}`,
    ...proof,
    "roi benchmarks (quote these figures ONLY inside an objection rebuttal, never in the opener or a touch):",
    ...pack.roiBenchmark.items.map((item) => `  - ${item.label}`),
    "",
    "=== WHO YOU ARE WRITING TO ===",
    ...contact,
    ...(request.corrections && request.corrections.length > 0
      ? [
          "",
          "=== YOUR PREVIOUS ATTEMPT WAS REJECTED. Fix exactly these, change nothing else. ===",
          ...request.corrections,
        ]
      : []),
  ].join("\n");
}

// ─── The JSON Schema handed to `output_config.format` ─────────────────────────
//
// Same measured constraints as `src/enrich/extract-prompt.ts` (E6, n=6):
//  - `additionalProperties: false` on EVERY object.
//  - Every property listed in `required`; optional ones expressed as nullable.
//  - No `minLength` / `maxLength` / `minItems` / `maxItems` — string and array size
//    constraints are NOT supported. `voiceBriefSchema` (zod) carries all of them, and
//    the system prompt states them so the contract is satisfiable rather than a trap.
//  - Structured outputs are INCOMPATIBLE WITH CITATIONS (400). Legal here only because
//    this call declares no tools at all.

const evidenceIdsJsonSchema = { type: "array", items: { type: "string" } } as const;

const touchJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    touchNumber: { type: "integer", enum: [1, 2, 3] },
    channel: { type: "string", enum: ["email", "call", "linkedin"] },
    subject: { type: "string" },
    body: { type: "string" },
    evidenceIds: evidenceIdsJsonSchema,
  },
  required: ["touchNumber", "channel", "subject", "body", "evidenceIds"],
} as const;

const objectionJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    objection: { type: "string" },
    rebuttal: { type: "string" },
  },
  required: ["objection", "rebuttal"],
} as const;

export const VOICE_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    headline: { anyOf: [{ type: "string" }, { type: "null" }] },
    headlineEvidenceIds: evidenceIdsJsonSchema,
    callOpener: { type: "string" },
    callOpenerEvidenceIds: evidenceIdsJsonSchema,
    personalizationSnippet: { type: "string" },
    personalizationEvidenceIds: evidenceIdsJsonSchema,
    sequence: {
      type: "object",
      additionalProperties: false,
      properties: {
        touches: { type: "array", items: touchJsonSchema },
        namedCta: { type: "string" },
      },
      required: ["touches", "namedCta"],
    },
    discoveryQuestions: { type: "array", items: { type: "string" } },
    objections: { type: "array", items: objectionJsonSchema },
  },
  required: [
    "headline",
    "headlineEvidenceIds",
    "callOpener",
    "callOpenerEvidenceIds",
    "personalizationSnippet",
    "personalizationEvidenceIds",
    "sequence",
    "discoveryQuestions",
    "objections",
  ],
} as const;
