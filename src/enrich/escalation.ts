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

export interface EscalationRequest {
  practiceName: string;
  city?: string | null;
  state?: string | null;
  websiteUrl?: string | null;
  /** Whatever the scraper did manage to hold. Often empty — that is why we are here. */
  pages: Map<string, string>;
}

export type EscalationOutcome =
  /** The budget was spent, or already zero. NOTHING was called and nothing was billed. */
  | { attempted: false }
  | { attempted: true; ok: true; findings: ResearchFindings; dropped: DroppedFact[]; unverifiable: DroppedFact[] }
  | { attempted: true; ok: false; reason: string };

/**
 * Run the agentic path ONCE, then hold its answer to the same standard as the primary
 * path wherever we can. Facts citing a page we hold must be verbatim on it. Facts citing
 * the open web are kept, counted, and flagged — see `VerifyOptions.unheldUrl`.
 *
 * A THROW here is caught: the escalation was the last resort, and a rate limit on the
 * last resort should fail the practice, not the cohort.
 */
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
    return {
      attempted: true,
      ok: false,
      reason: `escalation failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (!outcome.ok) {
    return { attempted: true, ok: false, reason: `escalation: ${outcome.reason}` };
  }

  const { verified, dropped, unverifiable } = verifyFindings(outcome.findings, request.pages, {
    unheldUrl: "keep-unverifiable",
  });

  if (isEmptyFindings(verified)) {
    // We paid $1.27 and every fact was refuted by a page we hold. That is a real,
    // recordable outcome — not a crash, and never a partial write.
    return { attempted: true, ok: false, reason: "escalation returned no usable facts" };
  }

  return { attempted: true, ok: true, findings: verified, dropped, unverifiable };
}
