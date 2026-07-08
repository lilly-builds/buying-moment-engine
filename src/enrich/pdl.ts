import type { Meter } from "@/src/roi/cost-meter";
import { PDL_USD_PER_MATCHED_RECORD, PIPELINE_STEP_PDL } from "./config";
import type {
  PdlClient,
  PdlCompanyRequest,
  PdlCompanyResult,
  PdlPersonRequest,
  PdlPersonResult,
} from "./types";

/**
 * Stage 2 of the waterfall: PDL fills ONLY the verified gaps Claude can't reliably
 * get — verified work email + LinkedIn URL (spec § Stack). It is metered per BILLED
 * record (R19) — an HTTP 200 — because that, and not our opinion of the payload, is
 * what PDL charges for. A true no-match comes back as a 404 and is free, so it
 * records `units = 0` rather than a $0.28 phantom charge.
 *
 * `matched` is a SEPARATE, semantic field: did we get a usable, above-threshold
 * person? A 200 we can't parse, and a 200 below `PDL_MIN_LIKELIHOOD`, are both
 * `billed: true, matched: false` — real spend, no usable data. Metering on
 * `matched` would book those at $0 and quietly understate CAC.
 *
 * A cost_events row is written for EVERY completed call, billed or not — that is
 * what makes "how many PDL lookups did this practice cost?" answerable from the
 * ledger instead of from a log.
 */

export interface PdlDeps {
  client: PdlClient;
  meter: Meter;
  practiceId?: string | null;
}

/** Metered person enrichment. Throws on 429 / network failure (unbilled -> unmetered). */
export async function runPdlPersonEnrich(
  deps: PdlDeps,
  request: PdlPersonRequest,
): Promise<PdlPersonResult> {
  return deps.meter(
    {
      provider: "pdl",
      operation: "person.enrich",
      pipelineStep: PIPELINE_STEP_PDL,
      practiceId: deps.practiceId ?? null,
      units: (result) => (result.billed ? 1 : 0),
      unitCostUsd: PDL_USD_PER_MATCHED_RECORD,
      meta: (result) => ({
        billed: result.billed,
        matched: result.matched,
        likelihood: result.likelihood,
        filledEmail: result.workEmail !== null,
        filledLinkedin: result.linkedinUrl !== null,
        // `true` = PDL holds it and the plan withholds it (paying would help).
        // `false` = PDL holds nothing (paying buys nothing). Not the same fact.
        emailWithheldByPlan: result.emailWithheldByPlan,
        linkedinWithheldByPlan: result.linkedinWithheldByPlan,
        // A billed 200 we could not parse is OUR bug. Make it loud in the ledger.
        unparseable: result.unparseable,
        parseError: result.parseError,
        // Human field, never an opaque id.
        person: request.fullName,
        company: request.companyName,
      }),
    },
    () => deps.client.enrichPerson(request),
  );
}

/**
 * Metered company enrichment. Used ONLY by stack-validation experiment #1, which
 * has to measure PDL's firmographic hit-rate to size the waterfall split. The
 * production waterfall never calls this: PDL returns no citable source page, so
 * its firmographics could not satisfy D2 and the brief would be forbidden from
 * stating them — money spent on data we cannot show.
 */
export async function runPdlCompanyEnrich(
  deps: PdlDeps,
  request: PdlCompanyRequest,
): Promise<PdlCompanyResult> {
  return deps.meter(
    {
      provider: "pdl",
      operation: "company.enrich",
      pipelineStep: PIPELINE_STEP_PDL,
      practiceId: deps.practiceId ?? null,
      units: (result) => (result.billed ? 1 : 0),
      unitCostUsd: PDL_USD_PER_MATCHED_RECORD,
      meta: (result) => ({
        billed: result.billed,
        matched: result.matched,
        company: request.companyName,
        employeeCount: result.employeeCount,
        locationsCount: result.locationsCount,
      }),
    },
    () => deps.client.enrichCompany(request),
  );
}
