/**
 * The review-qualifier prompt AND the JSON Schema that constrains its output (U3).
 * They live together because they are one contract: change the shape in one and the
 * other is a lie. `classify-schema.ts` (zod) then re-checks the result — the API
 * guarantees SHAPE, never TRUTH.
 *
 * The SYSTEM prompt is the FIXED frame: how to judge, and the precision guard. The
 * per-tenant `qualificationPrompt` is the SWAPPABLE criterion, injected at the user
 * turn by `buildClassifyPrompt` (R8) — the same call qualifies phone-access pain for
 * EliseAI or anything else another tenant defines, with no code change.
 *
 * Why the precision guard is load-bearing: an LLM asked "does this review show the
 * pain?" drifts GENEROUS, and a false positive puts a practice on the feed that is
 * not actually at a buying moment — polluting the one thing this engine sells. Rules
 * 3–5 are the counterweight (a positive mention is evidence AGAINST; off-topic does
 * not count; when in doubt, false). Rule 8 keeps review text out of the answer (R5):
 * the model returns a verdict + a closed-vocabulary label, never the review's words.
 */

export const CLASSIFY_SYSTEM_PROMPT = `You are a B2B buying-signal analyst. You are given ONE customer review of a business, plus a QUALIFICATION CRITERION describing a specific operational pain that would indicate the business needs a particular product or service.

Decide whether THIS review is concrete first-hand evidence of the pain in the criterion.

HARD RULES — these are constraints, not preferences:
1. Judge ONLY the supplied review text against the supplied criterion. Never use outside knowledge about the business, and never infer beyond what the review states.
2. The review QUALIFIES only if it describes a FIRST-HAND experience of the SPECIFIC pain in the criterion — an actual occurrence the reviewer lived, not a hypothetical, not a vague general grumble unrelated to the criterion.
3. A POSITIVE or NEUTRAL mention of the same topic does NOT qualify — it is evidence AGAINST the pain. "The staff were lovely on the phone and picked up right away" is the OPPOSITE of phone-access pain: return qualifies=false.
4. An OFF-TOPIC complaint does NOT qualify. A parking, billing, or bedside-manner gripe is not phone-access pain. Match the criterion, not merely a negative tone: return qualifies=false.
5. When in doubt, return qualifies=false. A false positive puts a business on the feed that is not actually in pain; precision matters more than recall here.
6. "confidence" is your own estimate, 0.0 to 1.0, that this review genuinely evidences the criterion. It is ADVISORY — a shape, not a proof.
7. "category" is a SHORT hyphenated label for WHICH facet of the pain the review shows — e.g. "cannot-get-through", "long-hold", "no-callback", "voicemail-full". If the review does not qualify, return "none". Never copy the review's own sentences or phrases into the category; it is your own closed-vocabulary tag.
8. Never quote, paraphrase, or echo the review text back in your output. Return ONLY the verdict, the confidence, and the category label.

Return exactly {"qualifies", "confidence", "category"} for the review.`;

/**
 * The user turn: the tenant's swappable criterion, then the one review. The
 * criterion is injected here (not baked into the system prompt) so two tenants with
 * two different criteria produce two DIFFERENT user messages from the same code —
 * that difference is what makes the qualifier genuinely per-tenant (R8).
 */
export function buildClassifyPrompt(
  qualificationPrompt: string,
  reviewText: string,
): string {
  return [
    "QUALIFICATION CRITERION (what a qualifying review looks like):",
    qualificationPrompt,
    "",
    "REVIEW:",
    reviewText,
    "",
    'Judge THIS review. Return {"qualifies", "confidence", "category"}.',
  ].join("\n");
}

// ─── The JSON Schema handed to `output_config.format` ─────────────────────────
//
// `additionalProperties: false` on the object, every property in `required` — the
// same constraints the extract path measured against the API (E6). No numeric
// bound here (structured outputs express shape, not range); the zod gate in
// `classify-schema.ts` carries `confidence` in [0,1] and `category` non-empty.
export const CLASSIFY_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    qualifies: { type: "boolean" },
    confidence: { type: "number" },
    category: { type: "string" },
  },
  required: ["qualifies", "confidence", "category"],
} as const;
