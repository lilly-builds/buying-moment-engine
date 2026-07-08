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
 *   Rule 8 — "a founding or owner physician named on an About/Team page IS a valid
 *             decision-maker". Without it the model reads "practice manager" literally
 *             and reports nothing for a one-physician practice.
 *   Rule 4 — "if you cannot find a single CONTIGUOUS verbatim span that by itself
 *             proves the fact, OMIT it. Never stitch." Without it the model tallies.
 *
 * Rules 5 and 6 are the newer pair, and they exist because a verbatim snippet was never
 * the same thing as a true claim: `{value: "Epic", snippet: "Our patient portal is
 * powered by ModMed EMA."}` cleared every check this file's contract used to impose.
 * Rule 5 makes `citations.ts`'s QUOTATION containment check SATISFIABLE — a model told
 * only "cite a verbatim snippet" has no reason to also copy the value out of it. Rule 6
 * says which fields are exempt, so the model does not omit a `specialty` it is right
 * about just because it summarized the page's wording.
 *
 * ⚠️ Rule 8's list is a SEARCH VOCABULARY, never an output vocabulary, and the two are one
 * edit away from contradicting rule 5. An earlier draft said only "in order of preference:
 * practice manager, … or the OWNER-PHYSICIAN" — so the model dutifully returned
 * `role: "Owner-Physician"` for Dr. Joel Schlessinger, whose real team page prints no role
 * noun anywhere. `role` is a QUOTATION field, so the verifier dropped it, the dropped role
 * collapsed the whole contact, and the drop row read `value-not-in-snippet` — the drift
 * alarm accusing the model of fabricating a role it had been *instructed* to produce. That
 * is E8 round 1's `decisionMaker: none` regression, reintroduced by the verifier. If you
 * touch rule 8, re-read rule 5 in the same breath.
 *
 * Every rule here is a REQUEST. `citations.ts` is the enforcement, and it caught a
 * stitched snippet in both E8 rounds. Never let this file be mistaken for the guarantee.
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
5. QUOTED FIELDS — "ehr", "incumbentTooling", "yearFounded", and the decision-maker's "name", "role" and "email". For these, the "value" MUST appear CHARACTER-FOR-CHARACTER inside the "snippet" you supply for it, as a WHOLE WORD or phrase — not as letters inside a longer word. Copy it out of the snippet. If no single contiguous span of the page contains the value, OMIT the fact — do not supply a nearby sentence instead.
   VALID:   {"value": "ModMed EMA", "snippet": "Our patient portal is powered by ModMed EMA."}
   INVALID: {"value": "Epic",       "snippet": "Our patient portal is powered by ModMed EMA."}   <- the snippet is real and it does not say Epic. This fact will be discarded.
   INVALID: {"value": "Epic",       "snippet": "We use Epicare for scheduling."}                 <- "Epic" is only letters inside "Epicare". Return "Epicare".
   For "incumbentTooling", the value is the tool's NAME exactly as the page prints it — "Podium", not "Podium reviews".
6. LABELLED FIELDS — "specialty", "website", "linkedinUrl" and "buyingMomentContext". For these the "value" is your own short label for what the snippet says, so it need NOT appear inside the snippet. The snippet must still be a verbatim span of the cited page. Example: {"value": "Orthopedics", "snippet": "Metro Ortho Group is Denver's largest independent orthopedic practice."}
7. Do NOT report how many locations or how many providers the practice has. Those are tallies with no single sentence that proves them. Code counts them from the evidence you cite.
8. "decisionMaker" is the person who would buy front-desk / patient-communication software. Choose WHO in this order of preference: practice manager, practice administrator, director of operations, COO, CEO, practice founder, or the OWNER-PHYSICIAN. A founding or owner physician named on an About or Team page IS a valid decision-maker — name them.
   The words in that list tell you who to LOOK FOR. They are not the value you return. "role" is a QUOTED field (rule 5): return that person's title or credential COPIED VERBATIM from the page — "Practice Administrator", "Chief Operating Officer", "MD". Never return a category word from the list above unless the page actually prints it.
   If the page names a person but prints no title or credential anywhere for them, return "decisionMaker": null — do not invent a title.
   If the page states a role but names no individual ("report directly to the Office Manager"), return that role verbatim with "name": null. That is the correct degradation, not a failure.
9. "buyingMomentContext" is timing intelligence a static data vendor cannot have: a new location, an acquisition or PE deal, a front-desk hiring push, a publicly announced expansion or new service line. Only what a page states.
10. Business information only. Never a patient. Staff appear only in their professional capacity.
11. The only firmographics fields are "specialty", "website" and "yearFounded". Set a field to null unless a page states it.

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
