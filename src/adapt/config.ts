/**
 * Adapt-It onboarding generation config (Phase 3). The Adapter interviews a
 * business and re-configures the whole engine to them. Two Claude calls run
 * here: a DRAFT config (`/api/adapt/generate`) and the sample feed
 * (`/api/adapt/finalize`).
 *
 * Model choice (LOCKED by the plan): Sonnet 5 for both calls — the nuanced
 * buying-moment reasoning is the product's whole thesis, and Sonnet 5 is the
 * cost/quality sweet spot for structured, reasoned JSON. Verified against the
 * Sonnet 5 request surface (see `src/adapt/client.ts` header): adaptive thinking
 * is ON by default, `temperature`/`top_p`/`top_k` are 400s, `effort` lives inside
 * `output_config`, and structured outputs (`output_config.format`) are supported.
 */

/** Sonnet 5 — the plan's locked model for config generation. */
export const ADAPT_MODEL = "claude-sonnet-5" as const;

/**
 * `medium` effort: a favorable balance for onboarding. The interview must feel
 * fast (the flow promises about two minutes), and `medium` keeps adaptive
 * thinking from over-deliberating on what is a bounded, well-specified extraction
 * plus light reasoning. Quality is protected by the deterministic fallback on any
 * miss, so we are never trading correctness for speed here.
 */
export const ADAPT_EFFORT = "medium" as const;

/**
 * `max_tokens` bounds thinking + output together. The draft config JSON is a few
 * hundred tokens; the headroom is for adaptive thinking. Streaming (see the
 * client) means a large ceiling never risks an HTTP timeout — a truncation here
 * degrades to the deterministic fallback, never a half-written config.
 */
export const ADAPT_DRAFT_MAX_TOKENS = 8000;

/** The sample feed is three briefs of prose — more output, so more headroom. */
export const ADAPT_FEED_MAX_TOKENS = 10000;

/**
 * A total-duration guard so the browser flow can never hang forever. A call
 * still running at this wall clock is abandoned and the endpoint returns the
 * deterministic fallback instead. Streaming resets the between-chunks timeout on
 * every `ping`, so only a genuinely stuck call trips this.
 */
export const ADAPT_FETCH_TIMEOUT_MS = 60_000;
