import type { ExtractRequest } from "./types";

/**
 * The extraction prompt AND the JSON Schema that constrains its output. They live
 * together because they are one contract: change the shape in one and the other is
 * a lie. `research-schema.ts` (zod) then re-checks the result — the API guarantees
 * SHAPE, never TRUTH.
 *
 * This is the ROUND-2 prompt from experiment E8, ported verbatim in substance. Round 1
 * returned `decisionMaker: none` on all three practices; round 2, on the *same held
 * page text*, named Dr. Joel Schlessinger — the same person the agentic path found.
 * Same input, different prompt, different result: the decision-maker regression was a
 * PROMPT problem, not a mechanism problem. Two clauses did it, and both are load-bearing:
 *
 *   Rule 6 — "a founding or owner physician named on an About/Team page IS a valid
 *             decision-maker". Without it the model reads "practice manager" literally
 *             and reports nothing for a one-physician practice.
 *   Rule 4 — "if you cannot find a single CONTIGUOUS verbatim span that by itself
 *             proves the fact, OMIT it. Never stitch." Without it the model tallies.
 *
 * Rule 4 is a REQUEST. `citations.ts` is the enforcement, and it caught a stitched
 * snippet in both rounds. Never let this file be mistaken for the guarantee.
 *
 * D9 binds: public BUSINESS information only, never a patient, and we only ever read
 * pages we already fetched — this call reaches nothing.
 */

export const EXTRACT_SYSTEM_PROMPT = `You are a B2B GTM researcher for a healthcare-software sales team. You are given the FULL TEXT of pages from ONE medical practice's website.

HARD RULES — these are constraints, not preferences:
1. Every fact must come from the supplied page text. Never use prior knowledge, never infer, never estimate.
2. "sourceUrl" MUST be copied EXACTLY from the "=== SOURCE: <url> ===" header of the page the fact came from.
3. "snippet" MUST be a VERBATIM, CONTIGUOUS substring of that page's text — copy and paste it. Do not paraphrase, do not fix typos, do not join across a gap. Keep it under 200 characters.
4. If a fact is not stated in the supplied text, return null (or omit it from an array). CRITICAL: if you cannot find a single CONTIGUOUS verbatim span that by itself proves the fact, OMIT THE FACT. Never stitch a snippet together from separate parts of a page. A count you had to tally yourself is not citable — omit it.
5. Do NOT report how many locations or how many providers the practice has. Those are tallies with no single sentence that proves them. Code counts them from the evidence you cite.
6. "decisionMaker" is the person who would buy front-desk / patient-communication software. In order of preference: practice manager, practice administrator, director of operations, COO, CEO, practice founder, or the OWNER-PHYSICIAN. A founding or owner physician named on an About or Team page IS a valid decision-maker — name them. Only if no individual is named anywhere should you set "name" to null and return the role alone.
7. "buyingMomentContext" is timing intelligence a static data vendor cannot have: a new location, an acquisition or PE deal, a front-desk hiring push, a publicly announced expansion or new service line. Only what a page states.
8. Business information only. Never a patient. Staff appear only in their professional capacity.
9. The only firmographics fields are "specialty", "website" and "yearFounded". Set a field to null unless a page states it.

Every fact object is exactly {"value", "sourceUrl", "snippet"}. Return null for any fact the pages do not state.`;

/** The header the model is told to copy its `sourceUrl` from, verbatim. */
export function sourceHeader(url: string): string {
  return `=== SOURCE: ${url} ===`;
}

/**
 * One block per held page. The URL keys ARE the citation namespace: the model is
 * physically unable to cite a page we do not hold, because no other URL appears in
 * its context. `citations.ts` then checks it did not invent one anyway.
 */
export function buildExtractPrompt(request: ExtractRequest): string {
  const location = [request.city, request.state].filter(Boolean).join(", ");
  const body = [...request.pages]
    .map(([url, text]) => `${sourceHeader(url)}\n${text}`)
    .join("\n\n");

  return [
    `Practice: ${request.practiceName}`,
    location ? `Location: ${location}` : null,
    "",
    "Extract the practice's firmographics, EHR / incumbent tooling, decision-maker,",
    "and buying-moment context from the page text below. Cite each fact to the exact",
    "SOURCE url it came from.",
    "",
    body,
  ]
    .filter((line) => line !== null)
    .join("\n");
}

// ─── The JSON Schema handed to `output_config.format` (KTD-5) ─────────────────
//
// Constraints measured against the API, not recalled (E6, n=6):
//  - `additionalProperties: false` on EVERY object. This is why `firmographics`
//    cannot be an open-ended map, and why an invented key is now impossible rather
//    than merely rejected downstream.
//  - Nullable leaves are `anyOf: [T, {type: "null"}]`. There is no `minLength`, no
//    numeric constraint, no recursion — the zod gate still carries those.
//  - Every property is listed in `required` and made nullable, instead of being left
//    out of `required`. That is the exact shape all six E6 calls returned; `null` and
//    "absent" both land on `undefined` in `research-schema.ts`.
//  - Structured outputs are INCOMPATIBLE WITH CITATIONS (400). Legal here only
//    because this call declares no `web_fetch`. The escalation path still hand-parses.

const citedFactJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    value: { type: "string" },
    sourceUrl: { type: "string" },
    snippet: { type: "string" },
  },
  required: ["value", "sourceUrl", "snippet"],
} as const;

const nullableCitedFact = {
  anyOf: [citedFactJsonSchema, { type: "null" }],
} as const;

export const EXTRACT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    firmographics: {
      type: "object",
      additionalProperties: false,
      properties: {
        specialty: nullableCitedFact,
        website: nullableCitedFact,
        yearFounded: nullableCitedFact,
      },
      required: ["specialty", "website", "yearFounded"],
    },
    ehr: nullableCitedFact,
    incumbentTooling: { type: "array", items: citedFactJsonSchema },
    decisionMaker: {
      anyOf: [
        {
          type: "object",
          additionalProperties: false,
          properties: {
            name: nullableCitedFact,
            role: citedFactJsonSchema,
            email: nullableCitedFact,
            linkedinUrl: nullableCitedFact,
          },
          required: ["name", "role", "email", "linkedinUrl"],
        },
        { type: "null" },
      ],
    },
    buyingMomentContext: { type: "array", items: citedFactJsonSchema },
  },
  required: [
    "firmographics",
    "ehr",
    "incumbentTooling",
    "decisionMaker",
    "buyingMomentContext",
  ],
} as const;
