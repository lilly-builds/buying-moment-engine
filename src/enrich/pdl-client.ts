import { z } from "zod";
import {
  PDL_COMPANY_ENRICH_URL,
  PDL_FETCH_TIMEOUT_MS,
  PDL_MIN_LIKELIHOOD,
  PDL_PERSON_ENRICH_URL,
} from "./config";
import {
  PdlRateLimitError,
  PdlRequestError,
  type PdlClient,
  type PdlCompanyRequest,
  type PdlCompanyResult,
  type PdlPersonRequest,
  type PdlPersonResult,
} from "./types";

/**
 * People Data Labs client — SYNCHRONOUS request/response (spec § Stack). There is
 * no callback, no webhook, and no async job: Clay was dropped precisely because it
 * was async and webhook-gated. Response shapes follow PDL's published Person /
 * Company Enrichment schemas.
 *
 * Status handling, and why it matters for R19:
 *  - 200 -> PDL BILLED this, full stop. `billed = true`, metered at units = 1 —
 *    even when the body is a shape we don't recognize, and even when `likelihood`
 *    is below threshold and we semantically call it a no-match.
 *  - 404 -> a true no-match. PDL does NOT bill this. `billed = false`, units = 0
 *    (the row is still written — the call happened, it just cost nothing).
 *  - 429 -> rate limited, NOT billed. Throws, so the meter records nothing.
 *  - anything else / network timeout -> throws, unbilled.
 *
 * So `billed` is the HTTP status; `matched` is our judgement about the payload.
 * Conflating them understates CAC on exactly the calls that went wrong.
 */

/**
 * On a FREE plan, PDL replaces restricted contact fields with a boolean PRESENCE
 * FLAG rather than the value. Per their docs:
 *
 *   "Free plans... do not have access to contact fields like emails, phone numbers,
 *    and street addresses and will instead appear as `true` if the value exists or
 *    `false` if it does not."
 *
 * So there are THREE states, not two, and conflating them is a real product error:
 *   - a string  → the value, and we may use it
 *   - `true`    → PDL HAS it, withheld until the plan is upgraded ("paying gets it")
 *   - `false`   → PDL DOES NOT HAVE IT. Upgrading buys nothing.
 *
 * Typing this as `z.string()` made the whole payload fail to parse, and the caller
 * reported the person as unmatched — our bug, sold as the vendor's missing data.
 *
 * Verified live (2026-07-08), one record carrying both booleans at once:
 *   satya nadella → work_email=false, personal_emails=true, mobile_phone=true,
 *                   linkedin_url="linkedin.com/in/satyanadella"  (a plain string)
 * `linkedin_url` is NOT a restricted field; it comes back on the free plan.
 */
const restrictedString = z.union([z.string(), z.boolean()]).nullish();

/** The value, when we are actually allowed to have it. */
function fieldValue(v: string | boolean | null | undefined): string | null {
  return typeof v === "string" ? v : null;
}

/**
 * `true` means "exists, but your plan withholds it" — the ONLY case where paying
 * more would produce a value. `false` means PDL has nothing, so an upgrade is money
 * for nothing. Getting this polarity backwards is how "PDL needs a paid plan"
 * becomes a purchasing decision built on a misread boolean.
 */
function isWithheldByPlan(v: string | boolean | null | undefined): boolean {
  return v === true;
}

const personResponseSchema = z.object({
  status: z.number(),
  likelihood: z.number().nullish(),
  data: z
    .object({
      work_email: restrictedString,
      recommended_personal_email: restrictedString,
      linkedin_url: restrictedString,
    })
    .loose()
    .nullish(),
});

/** Same licence convention as the person payload — a `false` must not break the parse. */
const companyResponseSchema = z.object({
  status: z.number(),
  likelihood: z.number().nullish(),
  employee_count: z.union([z.number(), z.boolean()]).nullish(),
  industry: restrictedString,
  website: restrictedString,
  location: z.unknown().nullish(),
  locations: z.array(z.unknown()).nullish(),
});

/** `billed` is supplied by the caller from the HTTP status — never guessed here. */
const NO_MATCH: Omit<PdlPersonResult, "billed"> = {
  matched: false,
  unparseable: false,
  parseError: null,
  likelihood: null,
  workEmail: null,
  linkedinUrl: null,
  // A no-match / unparsed payload tells us nothing about what PDL holds.
  emailWithheldByPlan: false,
  linkedinWithheldByPlan: false,
};

const NO_COMPANY_MATCH: Omit<PdlCompanyResult, "billed"> = {
  matched: false,
  likelihood: null,
  employeeCount: null,
  locationsCount: null,
  industry: null,
  website: null,
};

/** HTTP 200 is the billing event. Every other status either 404s free or throws. */
function isBilled(httpStatus: number): boolean {
  return httpStatus === 200;
}

/**
 * Read a BILLED 200's body without throwing. A 200 that isn't JSON at all (an
 * edge/proxy HTML page), or whose body stream dies mid-read, was still charged — so it
 * must reach the normalizer, which degrades it to `billed: true, matched: false`,
 * rather than throw past the meter.
 *
 * The READ is inside the guard, not just the parse: `res.text()` rejects on a broken
 * stream and would unwind exactly as far as the `JSON.parse` we are guarding against.
 * The undefined is not a swallowed error: it is the "unrecognized body" the
 * normalizer's safe-parse is written to handle.
 */
async function readJsonBody(res: Response): Promise<unknown> {
  try {
    return JSON.parse(await res.text()) as unknown;
  } catch {
    return undefined;
  }
}

/** What one PDL request actually returned: the status we bill on, and the payload. */
interface PdlHttpResponse {
  httpStatus: number;
  body: unknown;
}

/**
 * Normalize a person-enrich body. PURE — the fixture-driven tests call this directly.
 *
 * FOUR outcomes, deliberately distinct. Collapsing any two of them is how a $0.28
 * charge becomes an invisible "the vendor had no data":
 *
 *  - `unparseable`  — a 200 whose shape we do not understand. LOUD. Never silently a
 *                     no-match: that reports OUR bug as THEIR missing data. (This is
 *                     exactly what `work_email: false` used to trigger.)
 *  - no match (404) — PDL genuinely has no record. Not billed.
 *  - below threshold— a real record we CHOSE to reject; a guessed work email is worse
 *                     than none (D9: the AE must never be handed a fabricated address).
 *                     Billed, because PDL answered.
 *  - matched        — a usable record. Per-field, a restricted value may be absent for
 *                     two different reasons: PDL holds nothing (`false`), or PDL holds
 *                     it and the free plan withholds it (`true`). Only the latter is
 *                     fixable by paying. See `isWithheldByPlan`.
 *
 * `recommended_personal_email` is deliberately IGNORED — the spec's contract is public
 * BUSINESS contacts only; a personal inbox is not one.
 */
export function normalizePersonResponse(
  body: unknown,
  httpStatus: number,
): PdlPersonResult {
  const billed = isBilled(httpStatus);
  const parsed = personResponseSchema.safeParse(body);
  if (!parsed.success) {
    return {
      ...NO_MATCH,
      billed,
      unparseable: true,
      parseError: parsed.error.issues
        .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("; "),
    };
  }
  const { status, likelihood, data } = parsed.data;
  if (status !== 200 || !data) return { ...NO_MATCH, billed };
  if (likelihood != null && likelihood < PDL_MIN_LIKELIHOOD) {
    return { ...NO_MATCH, billed, likelihood };
  }
  return {
    billed,
    matched: true,
    unparseable: false,
    parseError: null,
    likelihood: likelihood ?? null,
    workEmail: fieldValue(data.work_email),
    linkedinUrl: fieldValue(data.linkedin_url),
    // `true` = PDL has it, upgrade to see it. `false` = PDL has nothing.
    emailWithheldByPlan: isWithheldByPlan(data.work_email),
    linkedinWithheldByPlan: isWithheldByPlan(data.linkedin_url),
  };
}

/** Normalize a company-enrich body. PURE. Used only by experiment #1. */
export function normalizeCompanyResponse(
  body: unknown,
  httpStatus: number,
): PdlCompanyResult {
  const billed = isBilled(httpStatus);
  const parsed = companyResponseSchema.safeParse(body);
  if (!parsed.success) return { ...NO_COMPANY_MATCH, billed };
  const data = parsed.data;
  if (data.status !== 200) return { ...NO_COMPANY_MATCH, billed };
  return {
    billed,
    matched: true,
    likelihood: data.likelihood ?? null,
    // A licence-withheld `false` must read as "unknown", never as a value.
    employeeCount:
      typeof data.employee_count === "number" ? data.employee_count : null,
    locationsCount: data.locations?.length ?? null,
    industry: fieldValue(data.industry),
    website: fieldValue(data.website),
  };
}

async function pdlGet(
  url: string,
  params: Record<string, string>,
  apiKey: string,
): Promise<PdlHttpResponse> {
  const target = new URL(url);
  for (const [key, value] of Object.entries(params)) {
    target.searchParams.set(key, value);
  }
  const res = await fetch(target.toString(), {
    headers: { "X-Api-Key": apiKey, accept: "application/json" },
    signal: AbortSignal.timeout(PDL_FETCH_TIMEOUT_MS),
  });

  if (res.status === 404) return { httpStatus: 404, body: { status: 404 } };
  if (res.status === 429) {
    const retryAfter = res.headers.get("retry-after");
    throw new PdlRateLimitError(retryAfter ? Number(retryAfter) : null);
  }
  if (!res.ok) throw new PdlRequestError(res.status, res.statusText);
  return { httpStatus: res.status, body: await readJsonBody(res) };
}

/** Production binding. `apiKey` is injected, never read from the module scope. */
export function pdlClient(apiKey: string): PdlClient {
  return {
    async enrichPerson(request: PdlPersonRequest): Promise<PdlPersonResult> {
      const { httpStatus, body } = await pdlGet(
        PDL_PERSON_ENRICH_URL,
        {
          name: request.fullName,
          company: request.companyName,
          min_likelihood: String(PDL_MIN_LIKELIHOOD),
        },
        apiKey,
      );
      return normalizePersonResponse(body, httpStatus);
    },

    async enrichCompany(request: PdlCompanyRequest): Promise<PdlCompanyResult> {
      const params: Record<string, string> = { name: request.companyName };
      if (request.website) params.website = request.website;
      const { httpStatus, body } = await pdlGet(
        PDL_COMPANY_ENRICH_URL,
        params,
        apiKey,
      );
      return normalizeCompanyResponse(body, httpStatus);
    },
  };
}
