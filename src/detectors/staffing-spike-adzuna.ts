import { z } from "zod";
import type { SignalCandidate } from "@/src/engine/detector";
import { classifyFrontDeskRole } from "./staffing-spike-classifier";

/**
 * Adzuna adapter for U4 (see `staffing-spike.recon.md` for the source
 * decision + ToS basis). Normalize is PURE (job JSON in, `SignalCandidate |
 * null` out) — unit-testable with no mocks. `fetchAdzunaJobs` is the only I/O
 * here, and it is thin by design: build the URL, fetch, return raw JSON for
 * the caller to validate.
 */

const adzunaJobSchema = z.object({
  id: z.string().optional(),
  title: z.string(),
  description: z.string().optional(),
  company: z.object({ display_name: z.string().optional() }).optional(),
  location: z
    .object({ display_name: z.string().optional(), area: z.array(z.string()).optional() })
    .optional(),
  redirect_url: z.url(),
  created: z.string().optional(),
});

export const adzunaSearchResponseSchema = z.object({
  results: z.array(adzunaJobSchema),
  count: z.number().optional(),
});

export type AdzunaJobResult = z.output<typeof adzunaJobSchema>;
export type AdzunaSearchResponse = z.output<typeof adzunaSearchResponseSchema>;

export interface StaffingSpikeQuery {
  /** Adzuna `what` keyword query. */
  what: string;
  /** 1-indexed results page. */
  page: number;
}

/** Injected fetcher — tests supply a fixture; production calls the real API. */
export type FetchJobsFn = (query: StaffingSpikeQuery) => Promise<unknown>;

/** Deterministic geo-key slug, e.g. "Tampa, FL" -> "tampa-fl". */
function slugifyGeo(location: string): string {
  return location
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Pure normalize: one Adzuna job result -> one `SignalCandidate`, or `null`
 * when the job isn't attributable (no employer name) or isn't a front-desk
 * role (R7 precision guard, delegated to the classifier).
 */
export function normalizeJobToCandidate(
  job: AdzunaJobResult,
  now: Date,
): SignalCandidate | null {
  const practiceHint = job.company?.display_name?.trim();
  if (!practiceHint) return null;

  const classification = classifyFrontDeskRole(job.title, job.description ?? "");
  if (!classification.isFrontDesk) return null;

  const parsedCreated = job.created ? new Date(job.created) : undefined;
  const detectedAt =
    parsedCreated && !Number.isNaN(parsedCreated.getTime()) ? parsedCreated : now;

  const candidate: SignalCandidate = {
    practiceHint,
    kind: "staffing_spike",
    confidence: classification.confidence,
    detectedAt,
    evidence: [
      {
        claim: `Job posting for "${job.title}" — front-desk/patient-access role (matched "${classification.matchedPhrase}")`,
        sourceUrl: job.redirect_url,
        snippet: job.description?.slice(0, 240),
        confidence: classification.confidence,
      },
    ],
  };

  const geoKey = job.location?.display_name
    ? slugifyGeo(job.location.display_name)
    : undefined;
  if (geoKey) candidate.geoKey = geoKey;

  return candidate;
}

const ADZUNA_BASE_URL = "https://api.adzuna.com/v1/api/jobs";
const ADZUNA_COUNTRY = "us";
/** Free developer tier today — U15 must confirm before scaling query volume. */
export const ADZUNA_UNIT_COST_USD = 0;

/**
 * Real I/O: calls the live Adzuna Jobs API. Requires `ADZUNA_APP_ID` /
 * `ADZUNA_APP_KEY` (see recon memo). Never called in tests — tests inject a
 * fixture-backed `FetchJobsFn` instead.
 */
export async function fetchAdzunaJobs(query: StaffingSpikeQuery): Promise<unknown> {
  const appId = process.env.ADZUNA_APP_ID;
  const appKey = process.env.ADZUNA_APP_KEY;
  if (!appId || !appKey) {
    throw new Error(
      "ADZUNA_APP_ID / ADZUNA_APP_KEY not configured — live staffing-spike fetch requires credentials (see staffing-spike.recon.md, U15)",
    );
  }

  const url = new URL(`${ADZUNA_BASE_URL}/${ADZUNA_COUNTRY}/search/${query.page}`);
  url.searchParams.set("app_id", appId);
  url.searchParams.set("app_key", appKey);
  url.searchParams.set("what", query.what);
  url.searchParams.set("content-type", "application/json");

  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`Adzuna API error: ${res.status} ${res.statusText}`);
  }
  return res.json();
}
