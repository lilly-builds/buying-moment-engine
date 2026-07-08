/**
 * Enrichment contracts (U5). Every external client is an INTERFACE so the pure
 * logic (gap detection, citation validation, cost math) unit-tests with no mocks
 * and the seams integration-test against recorded fixtures.
 *
 * The load-bearing type is `CitedFact`. Citation closure (D2/R5 — "the brief
 * never states an uncited fact") is STRUCTURAL here, not a request in a prompt:
 * a fact that cannot produce a `sourceUrl` and a `snippet` cannot be constructed,
 * and `research-schema.ts` rejects the model's output before it reaches the DB.
 * A politely-worded prompt is not an enforcement mechanism.
 */

/** One atom of enrichment: the value, the page it came from, the words that prove it. */
export interface CitedFact {
  value: string;
  sourceUrl: string;
  snippet: string;
}

/**
 * The decision-maker. `name` is nullable: D9's role-only variant. When Claude
 * cannot find a named person, we ship the ROLE with its citation and no invented
 * name — never a guess, never a failure.
 */
export interface DecisionMaker {
  name: CitedFact | null;
  role: CitedFact;
  email: CitedFact | null;
  linkedinUrl: CitedFact | null;
}

/**
 * A FIXED set of named fields, not a free-form `Record` (KTD-4, KTD-5).
 *
 * Two forces landed on the same answer:
 *  1. Structured outputs require `additionalProperties: false` on every object, so
 *     an open-ended map cannot be expressed as a JSON Schema at all.
 *  2. `locationsCount` and `providerCount` are TALLIES, and a tally has no
 *     contiguous sentence that proves it. The only way a model can produce a
 *     snippet for one is by stitching separate parts of a page together — which is
 *     exactly the fabrication `citations.ts` exists to catch. It caught this twice
 *     (E7), on those two fields, both times.
 *
 * So the model cites what a page STATES (`specialty`, `website`, `yearFounded`),
 * and code counts what must be counted. This is not a workaround; it drags the
 * repo back into compliance with its own architecture — "factual card fields are
 * assembled deterministically in code from evidence; the LLM writes only voice."
 */
export interface Firmographics {
  specialty?: CitedFact;
  website?: CitedFact;
  yearFounded?: CitedFact;
}

/**
 * The keys of `Firmographics`, fixed and ordered. Iterate this rather than
 * `Object.keys()`: it survives an absent key, it makes `dropped` read the same on
 * every run, and adding a field here fails the compile in every place that must
 * change with it.
 */
export const FIRMOGRAPHIC_FIELDS = [
  "specialty",
  "website",
  "yearFounded",
] as const satisfies readonly (keyof Firmographics)[];

export interface ResearchFindings {
  firmographics: Firmographics;
  /** Incumbent EHR, if the practice states it publicly. */
  ehr: CitedFact | null;
  /** Other incumbent tooling (patient portal, scheduling widget, review platform). */
  incumbentTooling: CitedFact[];
  /** null = no findable contact at all. */
  decisionMaker: DecisionMaker | null;
  /** The timing intel PDL has no data for — the tool's actual differentiator. */
  buyingMomentContext: CitedFact[];
}

// ─── Claude research client seam ──────────────────────────────────────────────

export interface ClaudeUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  /** usage.server_tool_use.web_search_requests — billed at $10/1,000. */
  webSearchRequests: number;
  /** usage.server_tool_use.web_fetch_requests — no charge beyond tokens. */
  webFetchRequests: number;
}

export const ZERO_USAGE: ClaudeUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheCreationInputTokens: 0,
  cacheReadInputTokens: 0,
  webSearchRequests: 0,
  webFetchRequests: 0,
};

export interface ResearchRequest {
  practiceName: string;
  city?: string | null;
  state?: string | null;
  /** Seeds web_fetch, which may only fetch URLs already present in the conversation. */
  websiteUrl?: string | null;
}

/**
 * The RAW response. Deliberately not parsed: the paid call has already happened
 * and must be metered even when the body turns out to be malformed. Parsing lives
 * outside the meter (`research-schema.ts`).
 */
export interface ResearchResponse {
  text: string;
  usage: ClaudeUsage;
  model: string;
  /**
   * Set ONLY when a billed 200 could not be priced from its own body — we could
   * not even salvage its `usage` block. The meter writes the reason into the
   * cost_events row: "a call happened and we could not price it" is strictly
   * better than no row at all, which is money that vanishes.
   */
  unpricedReason?: string;
  /**
   * A 200 whose STREAM died or errored mid-body. The call is still priced from the
   * tokens seen before the failure; this carries `err.cause.code` into the cost row's
   * meta, so "fetch failed" becomes `UND_ERR_HEADERS_TIMEOUT` and a symptom becomes
   * a diagnosis.
   */
  streamError?: string;
}

export interface ResearchClient {
  research(request: ResearchRequest): Promise<ResearchResponse>;
}

// ─── Claude extraction client seam (the PRIMARY path) ─────────────────────────

/**
 * Extraction reads text we already hold. `pages` is `Map<absoluteUrl, cleanedText>`
 * exactly as `scrape.ts` produced it — never a flattened blob (KTD-3). The URL key
 * is what the model is told to cite and what `citations.ts` checks the snippet
 * against; join the pages together and provenance is gone, leaving only "this
 * sentence exists somewhere."
 */
export interface ExtractRequest {
  practiceName: string;
  city?: string | null;
  state?: string | null;
  pages: Map<string, string>;
}

/**
 * Same raw shape as `ResearchClient`: text + usage + model, parsed outside the
 * meter. A billed 200 whose body we cannot read is a resolved response carrying
 * `unpricedReason`, never a throw.
 */
export interface ExtractClient {
  extract(request: ExtractRequest): Promise<ResearchResponse>;
}

// ─── PDL client seam ──────────────────────────────────────────────────────────

export interface PdlPersonRequest {
  fullName: string;
  companyName: string;
  role?: string | null;
}

/**
 * PDL fills ONLY the verified work email + LinkedIn URL (spec § Stack). It is a
 * black-box vendor with no page to cite, so nothing it returns may ever become a
 * `practice_facts` row — those require an evidence FK. Its output is tagged with
 * `provider = 'pdl'` on `contacts` so the brief can say where it came from.
 */
export interface PdlPersonResult {
  /**
   * An HTTP FACT, not a judgement: PDL bills EVERY 200 and returns 404 for a true
   * no-match. Metering keys on `billed`, NEVER on `matched` — a 200 whose body we
   * fail to recognize, or whose `likelihood` falls below `PDL_MIN_LIKELIHOOD`, was
   * still charged, and a $0 cost_events row for it is money vanishing from CAC.
   */
  billed: boolean;
  /**
   * A SEMANTIC judgement: did we get a usable, above-threshold person back? Drives
   * the waterfall's gap-fill; it must never drive the meter.
   */
  matched: boolean;
  /**
   * A 200 whose body we could not parse. LOUD, and never folded into `matched:false`
   * — a parse failure is OUR bug; reporting it as the vendor having no data produced
   * a false experimental finding once already. Always billed.
   */
  unparseable: boolean;
  parseError: string | null;
  likelihood: number | null;
  workEmail: string | null;
  linkedinUrl: string | null;
  /**
   * On a free plan PDL replaces a restricted contact field with a PRESENCE FLAG:
   * `true` = "we hold this, upgrade to see it", `false` = "we hold nothing".
   * So `workEmail === null && emailWithheldByPlan === true` means paying would
   * produce an address, while `=== false` means paying buys nothing. Verified live:
   * work_email came back `false` on every record tested, while personal_emails and
   * mobile_phone came back `true` — i.e. the paid tier sells the fields D9 forbids
   * (personal inbox, mobile), not the work email the spec permits.
   */
  emailWithheldByPlan: boolean;
  linkedinWithheldByPlan: boolean;
}

export interface PdlCompanyRequest {
  companyName: string;
  website?: string | null;
}

/**
 * Company enrichment is used ONLY by the stack-validation harness (experiment #1),
 * which has to measure PDL's firmographic hit-rate to size the waterfall split.
 * The production waterfall never calls it: PDL's firmographics carry no citable
 * source, so they could not satisfy D2 and would be money spent on data the brief
 * is forbidden from stating.
 */
export interface PdlCompanyResult {
  /** See `PdlPersonResult.billed`: PDL bills every 200, and 404s a true no-match. */
  billed: boolean;
  matched: boolean;
  likelihood: number | null;
  employeeCount: number | null;
  locationsCount: number | null;
  industry: string | null;
  website: string | null;
}

export interface PdlClient {
  enrichPerson(request: PdlPersonRequest): Promise<PdlPersonResult>;
  enrichCompany(request: PdlCompanyRequest): Promise<PdlCompanyResult>;
}

// ─── Errors ───────────────────────────────────────────────────────────────────

/** Thrown on a 429. The call was NOT billed, so the meter must not record it. */
export class PdlRateLimitError extends Error {
  constructor(readonly retryAfterSeconds: number | null) {
    super("PDL rate limit exceeded (429)");
    this.name = "PdlRateLimitError";
  }
}

export class PdlRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(`PDL request failed: ${status} ${message}`);
    this.name = "PdlRequestError";
  }
}

export class AnthropicRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(`Anthropic request failed: ${status} ${message}`);
    this.name = "AnthropicRequestError";
  }
}
