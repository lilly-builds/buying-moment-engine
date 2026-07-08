import type { Meter } from "@/src/roi/cost-meter";
import { verifyFindings, type DroppedFact } from "./citations";
import { MAX_ESCALATIONS_PER_RUN } from "./config";
import { runResearch } from "./research";
import { isEmptyFindings } from "./research-schema";
import type { ResearchClient, ResearchFindings } from "./types";

/**
 * The agentic fallback, and the money that guards it.
 *
 * Escalation is the OLD mechanism, kept for the rare practice the new one cannot read:
 * a site that blocks us, a site that is a JavaScript shell, a practice whose facts live
 * on a press release we never fetched. It costs $1.27 and takes 4-5 minutes. It is not a
 * retry — it is a different model reading different input.
 *
 * ─── The two rules ────────────────────────────────────────────────────────────
 *
 * 1. FIRE ON A BAD RESULT, NOT ON A THROW (KTD-7). Optiflow's `process-lead.ts` guards
 *    gate3 with `withResultRetry` and gate4 with `withRetry`, so a low-confidence
 *    ENRICHMENT is never retried while a thrown one is retried three times against the
 *    same input — three identical answers, three times the bill. Here: a thin scrape and
 *    zero verified facts escalate; a 429 does not. And escalating genuinely changes
 *    something — Sonnet 5 browsing the web instead of Haiku reading our text.
 *
 * 2. TRIGGERING IS FREE; FIRING IS NOT. `escalationTrigger` is a deterministic
 *    observation; `escalated` means $1.27 left the account. A run-wide budget separates
 *    them, and U8 sets that budget to ZERO — recording how often escalation WOULD fire
 *    across a real cohort before deciding whether to pay to find out.
 */

/**
 * Shared across every practice in ONE cohort run, deliberately: the cap is on the RUN's
 * spend, not on a single practice. Mutable, and passed by reference for that reason.
 */
export interface EscalationBudget {
  /** Consume one escalation. `false` once the run's budget is spent — no call is made. */
  take(): boolean;
  readonly spent: number;
  readonly max: number;
}

export function createEscalationBudget(
  max: number = MAX_ESCALATIONS_PER_RUN,
): EscalationBudget {
  let spent = 0;
  return {
    take() {
      if (spent >= max) return false;
      spent += 1;
      return true;
    },
    get spent() {
      return spent;
    },
    get max() {
      return max;
    },
  };
}

/** A budget of zero: triggers are recorded, nothing is ever bought. U8's setting. */
export function noEscalationBudget(): EscalationBudget {
  return createEscalationBudget(0);
}

export interface EscalationDeps {
  client: ResearchClient;
  meter: Meter;
  budget: EscalationBudget;
  practiceId?: string | null;
}

/**
 * Deliberately carries NO page map. The pages we hold cannot adjudicate what the agentic
 * model read off the live web — see `runEscalation`. Passing them would only tempt a
 * future reader to verify against the wrong substrate.
 */
export interface EscalationRequest {
  practiceName: string;
  city?: string | null;
  state?: string | null;
  websiteUrl?: string | null;
}

export type EscalationOutcome =
  /** The budget was spent, or already zero. NOTHING was called and nothing was billed. */
  | { attempted: false }
  | {
      attempted: true;
      ok: true;
      /** Always true: a resolved agentic response means Anthropic returned a 200. */
      billed: true;
      findings: ResearchFindings;
      unverifiable: DroppedFact[];
    }
  | {
      attempted: true;
      ok: false;
      /**
       * `false` ONLY when the call THREW before a 200 — a 429, a DNS failure. The meter
       * correctly wrote nothing, so `escalated` must not claim we bought anything.
       * Reporting $0 as $1.27 is the Westlake bug pointing the other way.
       */
      billed: boolean;
      reason: string;
    };

/**
 * Run the agentic path ONCE.
 *
 * ─── Why its facts are NOT verified against the pages we hold ─────────────────
 *
 * The obvious thing — "hold the agentic path to the same standard, it cites pages we
 * have" — is wrong, and it is wrong in the direction that destroys true facts.
 *
 * Sonnet did not read our text. It `web_fetch`ed the LIVE page. Our copy came out of
 * `cleanHtml`, which deletes `nav`/`header`/`footer`, drops every paragraph under 20
 * characters, emits all headings BEFORE all prose (so document order is gone), dedupes
 * repeated sections, and truncates at 8k. Every one of those is invisible to the
 * verifier's normalizer. A snippet Sonnet copied verbatim off the real page can be
 * absent from ours — and would then be reported as `snippet-not-verbatim`, i.e. as
 * fabrication, on the one path that costs $1.27.
 *
 * Worse, it poisons the signal: `dropped` is the prompt-drift alarm. Filling it with
 * false positives from a substrate mismatch makes the alarm useless.
 *
 * So we verify against NOTHING. Every agentic fact comes back `unverifiable`
 * (`url-not-held`) and is persisted at the pre-refactor assurance level — which is
 * exactly what a rare fallback should cost, and is what the mechanism plan authorized.
 * Making these facts *provable* means holding a substrate Sonnet actually read (raw
 * per-URL page text, unpruned). That is a real improvement and it is not this change.
 *
 * A THROW is caught: escalation was the last resort, and a rate limit on the last resort
 * should fail the practice, not the cohort.
 */
const NO_SUBSTRATE_WE_CAN_VERIFY_AGAINST: ReadonlyMap<string, string> = new Map();

export async function runEscalation(
  deps: EscalationDeps,
  request: EscalationRequest,
): Promise<EscalationOutcome> {
  if (!deps.budget.take()) return { attempted: false };

  let outcome;
  try {
    outcome = await runResearch(
      { client: deps.client, meter: deps.meter, practiceId: deps.practiceId },
      {
        practiceName: request.practiceName,
        city: request.city,
        state: request.state,
        websiteUrl: request.websiteUrl,
      },
    );
  } catch (err) {
    // UNBILLED. The meter wrote nothing, and neither may the spend report.
    return {
      attempted: true,
      ok: false,
      billed: false,
      reason: `escalation failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (!outcome.ok) {
    // A billed 200 whose body would not parse. The money is on the ledger.
    return { attempted: true, ok: false, billed: true, reason: `escalation: ${outcome.reason}` };
  }

  const { verified, unverifiable } = verifyFindings(
    outcome.findings,
    new Map(NO_SUBSTRATE_WE_CAN_VERIFY_AGAINST),
    { unheldUrl: "keep-unverifiable" },
  );

  if (isEmptyFindings(verified)) {
    // We paid $1.27 and the model returned nothing at all. Recordable, never a partial write.
    return { attempted: true, ok: false, billed: true, reason: "escalation returned no usable facts" };
  }

  return { attempted: true, ok: true, billed: true, findings: verified, unverifiable };
}
