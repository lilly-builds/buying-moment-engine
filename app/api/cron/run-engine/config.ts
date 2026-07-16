import {
  DEFAULT_ENGINE_BRIEF_LIMIT,
  MAX_ENGINE_BRIEF_LIMIT,
  type DownstreamCohort,
  type EnginePhase,
} from "@/jobs/run-engine";

export const DEFAULT_DISCOVERY_METRO_LIMIT = 3;
export const MAX_DISCOVERY_METRO_LIMIT = 50;
export const DEFAULT_DISCOVERY_PER_CATEGORY_LIMIT = 2;
export const MAX_DISCOVERY_PER_CATEGORY_LIMIT = 20;
export const DEFAULT_DISCOVERY_REVIEW_LIMIT = 2;
export const MAX_DISCOVERY_REVIEW_LIMIT = 5;
export const SCHEDULED_DOWNSTREAM_LIMIT = 1;
export const SCHEDULED_CROSS_CHECK_LIMIT = 1;

const SAFE_INVOCATION_MS = 270_000;
const MIN_LEAD_START_MS = 210_000;
// The voice client can legally run for 120s; keep another 10s for persistence and response.
const MIN_VOICE_ATTEMPT_MS = 130_000;

function resolvePositiveIntLimit(
  raw: string | null | undefined,
  fallback: number,
  max: number,
): number {
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(Math.floor(n), max);
}

export function resolveDownstreamCohort(request: Request): DownstreamCohort {
  const raw = new URL(request.url).searchParams.get("cohort");
  if (
    raw === "website_present" ||
    raw === "needs_contact" ||
    raw === "named_no_email" ||
    raw === "weak_email" ||
    raw === "website_missing"
  ) {
    return raw;
  }
  return "all";
}

export function resolveBriefLimit(request?: Request): number {
  const queryLimit = request
    ? new URL(request.url).searchParams.get("limit")?.trim()
    : null;
  const raw = queryLimit || process.env.ENGINE_BRIEF_LIMIT?.trim();
  if (!raw) return DEFAULT_ENGINE_BRIEF_LIMIT;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return DEFAULT_ENGINE_BRIEF_LIMIT;
  return Math.min(Math.floor(n), MAX_ENGINE_BRIEF_LIMIT);
}

export function resolveScheduledBriefLimit(
  request: Request,
  phase: EnginePhase,
  hasPipelineClients: boolean,
): number {
  if (!hasPipelineClients) return 0;
  const queryLimit = new URL(request.url).searchParams.get("limit")?.trim();
  if (phase === "downstream" && !queryLimit) return SCHEDULED_DOWNSTREAM_LIMIT;
  return resolveBriefLimit(request);
}

export function resolveDiscoveryMetroLimit(request?: Request): number {
  const queryLimit = request
    ? new URL(request.url).searchParams.get("metroLimit")?.trim()
    : null;
  return resolvePositiveIntLimit(
    queryLimit || process.env.DISCOVERY_METRO_LIMIT?.trim(),
    DEFAULT_DISCOVERY_METRO_LIMIT,
    MAX_DISCOVERY_METRO_LIMIT,
  );
}

export function resolveDiscoveryPerCategoryLimit(request?: Request): number {
  const queryLimit = request
    ? new URL(request.url).searchParams.get("discoveryLimit")?.trim()
    : null;
  return resolvePositiveIntLimit(
    queryLimit || process.env.DISCOVERY_PER_CATEGORY_LIMIT?.trim(),
    DEFAULT_DISCOVERY_PER_CATEGORY_LIMIT,
    MAX_DISCOVERY_PER_CATEGORY_LIMIT,
  );
}

export function resolveDiscoveryReviewLimit(request?: Request): number {
  const queryLimit = request
    ? new URL(request.url).searchParams.get("reviewLimit")?.trim()
    : null;
  return resolvePositiveIntLimit(
    queryLimit || process.env.DISCOVERY_REVIEW_LIMIT?.trim(),
    DEFAULT_DISCOVERY_REVIEW_LIMIT,
    MAX_DISCOVERY_REVIEW_LIMIT,
  );
}

export function createInvocationBudget(now: () => number = Date.now): {
  canStartLead: () => boolean;
  canStartVoiceAttempt: () => boolean;
} {
  const deadlineAt = now() + SAFE_INVOCATION_MS;
  const remaining = () => deadlineAt - now();
  return {
    canStartLead: () => remaining() >= MIN_LEAD_START_MS,
    canStartVoiceAttempt: () => remaining() >= MIN_VOICE_ATTEMPT_MS,
  };
}
