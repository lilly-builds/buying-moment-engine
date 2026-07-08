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

const personResponseSchema = z.object({
  status: z.number(),
  likelihood: z.number().nullish(),
  data: z
    .object({
      work_email: z.string().nullish(),
      recommended_personal_email: z.string().nullish(),
      linkedin_url: z.string().nullish(),
    })
    .loose()
    .nullish(),
});

const companyResponseSchema = z.object({
  status: z.number(),
  likelihood: z.number().nullish(),
  employee_count: z.number().nullish(),
  industry: z.string().nullish(),
  website: z.string().nullish(),
  location: z.unknown().nullish(),
  locations: z.array(z.unknown()).nullish(),
});

/** `billed` is supplied by the caller from the HTTP status — never guessed here. */
const NO_MATCH: Omit<PdlPersonResult, "billed"> = {
  matched: false,
  likelihood: null,
  workEmail: null,
  linkedinUrl: null,
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
 * edge/proxy HTML page) was still charged, so it must reach the normalizer — which
 * degrades it to `billed: true, matched: false` — rather than throw past the meter.
 * The undefined is not a swallowed error: it is the "unrecognized body" the
 * normalizer's safe-parse is written to handle.
 */
async function readJsonBody(res: Response): Promise<unknown> {
  const raw = await res.text();
  try {
    return JSON.parse(raw) as unknown;
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
 * Normalize a person-enrich body. PURE — the fixture-driven tests call this
 * directly. A match below `PDL_MIN_LIKELIHOOD` is treated as NO match: a guessed
 * work email is worse than no email (D9 — we never contact a practice, and the
 * AE must never be handed a fabricated address). It is still `billed`: PDL charged
 * for the 200 regardless of what we decided to do with the payload.
 *
 * `recommended_personal_email` is deliberately IGNORED. The spec's contract is
 * public BUSINESS contacts only; a personal inbox is not one.
 */
export function normalizePersonResponse(
  body: unknown,
  httpStatus: number,
): PdlPersonResult {
  const billed = isBilled(httpStatus);
  const parsed = personResponseSchema.safeParse(body);
  if (!parsed.success) return { ...NO_MATCH, billed };
  const { status, likelihood, data } = parsed.data;
  if (status !== 200 || !data) return { ...NO_MATCH, billed };
  if (likelihood != null && likelihood < PDL_MIN_LIKELIHOOD) {
    return { ...NO_MATCH, billed, likelihood };
  }
  return {
    billed,
    matched: true,
    likelihood: likelihood ?? null,
    workEmail: data.work_email ?? null,
    linkedinUrl: data.linkedin_url ?? null,
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
    employeeCount: data.employee_count ?? null,
    locationsCount: data.locations?.length ?? null,
    industry: data.industry ?? null,
    website: data.website ?? null,
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
