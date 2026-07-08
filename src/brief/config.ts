import type { ModelRates } from "@/src/enrich/config";

/**
 * Brief-synthesizer configuration (U6). Same rule as `src/enrich/config.ts`: every
 * price is a NAMED constant carrying the source it came from. CAC is a measured
 * number (R19/D10), and a measured number must be auditable back to a published
 * rate card.
 *
 * Verified 2026-07-08 against the Anthropic model overview + pricing docs.
 */

// ─── Model (spec § Stack — LOCKED) ────────────────────────────────────────────
//
// "Anthropic Claude — Opus 4.8 (brief voice)". This is the ONE place Opus is used
// in the repo. Enrichment extraction runs on Haiku 4.5 and the rare agentic
// escalation on Sonnet 5 (`src/enrich/config.ts`); neither writes AE-facing prose.
//
// KTD (build plan): "runtime synthesis runs on Opus 4.8, validated against the brief
// schema on every call." Briefs are generated once at seeding and persisted, so the
// per-brief cost is negligible and the quality of the AE-facing voice is the whole
// point of the unit.
export const VOICE_MODEL = "claude-opus-4-8" as const;

/**
 * Request-shape constraints for Opus 4.8, verified against the API docs rather
 * than recalled. Getting any of these wrong is a 400, not a soft degradation:
 *
 *  - `temperature` / `top_p` / `top_k` are REMOVED. Sending one is a 400.
 *    Voice is steered by the prompt (`prompts/voice.ts`), never by sampling.
 *  - `thinking: {type: "enabled", budget_tokens: N}` is REMOVED — 400.
 *    `{type: "adaptive"}` is the only on-mode, and it is OFF when the field is
 *    omitted. We set it explicitly: the schema forces the model to attach an
 *    evidence id to every claim it writes, which is exactly the kind of
 *    multi-constraint work adaptive thinking exists for.
 *  - `effort` lives INSIDE `output_config`, never top-level. Default is `high`;
 *    we state it anyway so a future default change cannot silently re-price us.
 *  - Structured outputs (`output_config.format`) are supported, and are
 *    INCOMPATIBLE with the citations feature (400). We declare no `web_fetch`
 *    and no citations here, so the primary path may use them — same reasoning as
 *    `src/enrich/extract.ts`.
 */
export const VOICE_EFFORT = "high" as const;

/**
 * Thinking is billed against `max_tokens` alongside the answer, so this ceiling
 * covers BOTH. A brief's voice JSON measures well under 2k output tokens; 16k
 * leaves adaptive thinking real room while staying under the SDK's non-streaming
 * HTTP timeout guidance (~16k). A `stop_reason: "max_tokens"` truncation under
 * structured outputs yields syntactically incomplete JSON, which `parseVoiceOutput`
 * reports as a malformed body — loud, and never a silently half-written brief.
 */
export const VOICE_MAX_TOKENS = 16_000;

// ─── Anthropic pricing (USD per token) ────────────────────────────────────────
//
// https://platform.claude.com/docs/en/about-claude/models/overview
// Claude Opus 4.8 list price: $5 / input MTok, $25 / output MTok. 1M context.
// No long-context premium, and no introductory rate to expire mid-demo (unlike
// Sonnet 5, which is why `src/enrich/config.ts` meters that model at list).
export const OPUS_INPUT_USD_PER_TOKEN = 5 / 1_000_000;
export const OPUS_OUTPUT_USD_PER_TOKEN = 25 / 1_000_000;

/**
 * Passed EXPLICITLY to `anthropicCallCostUsd`, which has no default rate card —
 * a forgotten argument would price an Opus call at Haiku rates, silently, by 5x,
 * in the one number (CAC) this repo exists to measure.
 */
export const VOICE_RATES: ModelRates = {
  model: VOICE_MODEL,
  inputUsdPerToken: OPUS_INPUT_USD_PER_TOKEN,
  outputUsdPerToken: OPUS_OUTPUT_USD_PER_TOKEN,
};

/**
 * A plain Messages call over evidence we already hold — no browsing, no server
 * tools. Bounded by Anthropic, not by the web. It must never inherit the agentic
 * path's 10-minute ceiling; adaptive thinking on a brief is seconds, so a 120s
 * abort is a real signal that something is wrong.
 */
export const VOICE_FETCH_TIMEOUT_MS = 120_000;

/** `cost_events.pipeline_step` — the scoreboard slices spend on this (R19). */
export const PIPELINE_STEP_BRIEF = "brief.voice";

/**
 * How many times a brief may be re-generated inside ONE `synthesizeBrief` call
 * when the lint rejects the model's prose (an ungrounded number, a banned
 * phrase). One retry, never a loop: the retry carries the specific violations
 * back to the model, so a second failure means the evidence cannot support the
 * brief — not that a third identical roll would land. Each attempt is a separate
 * billed call and each writes its own `cost_events` row.
 */
export const VOICE_MAX_ATTEMPTS = 2;

/** The brief JSON shape version, stamped on every persisted row (`briefs.schema_version`). */
export const BRIEF_SCHEMA_VERSION = 1;
