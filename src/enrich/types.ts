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

export interface ResearchFindings {
  /** Free-form firmographic fields (specialty, locationsCount, providerCount, ...). */
  firmographics: Record<string, CitedFact>;
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
}

export interface ResearchClient {
  research(request: ResearchRequest): Promise<ResearchResponse>;
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
  matched: boolean;
  likelihood: number | null;
  workEmail: string | null;
  linkedinUrl: string | null;
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
