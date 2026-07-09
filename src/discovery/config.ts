import {
  HAIKU_INPUT_USD_PER_TOKEN,
  HAIKU_OUTPUT_USD_PER_TOKEN,
  type ModelRates,
} from "@/src/enrich/config";

/**
 * Discovery configuration (U3/U8) — every price a NAMED constant with its source,
 * exactly as `src/enrich/config.ts` does. CAC is a measured number; a measured
 * number has to be auditable back to a published rate card.
 */

// ─── The review qualifier (mirrors the EXTRACT path) ──────────────────────────
//
// One Haiku 4.5 call over ONE review's text — no web tools, no reasoning depth —
// the same shape as extraction, priced at the same Haiku rate card. Reuse the
// enrich rate constants rather than restating them, so a price change lands once.
export const CLASSIFY_MODEL = "claude-haiku-4-5" as const;

export const CLASSIFY_RATES: ModelRates = {
  model: CLASSIFY_MODEL,
  inputUsdPerToken: HAIKU_INPUT_USD_PER_TOKEN,
  outputUsdPerToken: HAIKU_OUTPUT_USD_PER_TOKEN,
};

/**
 * One review's verdict is a tiny JSON object ({qualifies, confidence, category}).
 * 512 is ample and bounds a runaway; under structured outputs a `max_tokens`
 * truncation yields syntactically incomplete JSON, which `parseClassifyOutput`
 * degrades to a recorded parse failure rather than a throw.
 */
export const CLASSIFY_MAX_TOKENS = 512;

/**
 * A PLAIN Messages call over one short review — bounded by Anthropic, not the web.
 * Seconds, never minutes; a 60s abort is a real signal that something is wrong.
 */
export const CLASSIFY_FETCH_TIMEOUT_MS = 60_000;

/** `cost_events` provider + pipeline_step values — the scoreboard slices spend on these. */
export const DISCOVERY_PROVIDER_GOOGLE = "google_places";
export const PIPELINE_STEP_DISCOVERY_SEARCH = "discovery.search";
export const PIPELINE_STEP_DISCOVERY_DETAILS = "discovery.details";
/** `cost_events.pipeline_step` for the discovery review-qualifier (scoreboard slice). */
export const PIPELINE_STEP_CLASSIFY = "discovery.classify";

/**
 * Per-ICP-category enumeration cap (one Text Search page is 20). Bounds spend:
 * worst case per run is `categories × (1 search + limit × (1 details + reviews × 1 classify))`.
 */
export const DEFAULT_PER_CATEGORY_LIMIT = 20;

/**
 * A review qualifies a place only when the model returns `qualifies=true` AND its
 * advisory confidence clears this floor — a second precision guard on top of the
 * prompt's. Deliberately a run-level default, not a tenant field yet: it is tuned
 * from the first live runs (Open Questions) before being promoted per-tenant.
 */
export const DEFAULT_CONFIDENCE_FLOOR = 0.6;

// ─── Google Places pricing on the discovery path (K8) ─────────────────────────
//
// Text Search enumeration (~3.2¢) is priced by GOOGLE_TEXT_SEARCH_UNIT_COST_USD in
// places-search.ts. This is the OTHER Places SKU discovery pays: Place Details
// with Atmosphere data (reviews) — the ~4¢ call the rating funnel and re-pull
// cache exist to gate (K6). The existing phone-complaints detector still carries
// its own flagged 0.005 placeholder (its recon note owns that); discovery meters
// at this accurate rate. Confirm the billed tier on the Google console before
// scaling (origin doc's 🟡 pricing note) — discovery makes many Details calls, so
// CAC accuracy depends on it.
export const GOOGLE_PLACE_DETAILS_UNIT_COST_USD = 0.04;
