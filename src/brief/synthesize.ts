import { upsertBrief } from "@/db/brief";
import type { Database } from "@/db/types";
import type { Meter } from "@/src/roi/cost-meter";
import { assembleFactual } from "./assemble";
import { VOICE_MAX_ATTEMPTS } from "./config";
import { allowedEvidenceIds, buildBriefInput, groundingParts, type BriefInput, type SignalRow } from "./inputs";
import { buildGroundingCorpus, formatViolations, lintVoice, type Violation } from "./lint";
import { referencedEvidenceIds, type FactualBrief, type VoiceBrief } from "./schema";
import { runVoice, type VoiceClient } from "./voice";

/**
 * The brief synthesizer (U6) — the highest-judgment code in the repo, and the place every
 * earlier unit's discipline either pays off or leaks.
 *
 * Stage 1 (`assemble.ts`) builds the factual tier in code from evidence rows and the
 * vertical pack. Stage 2 (`voice.ts`) asks Opus 4.8 for prose and nothing else. Between
 * them and the database sit three gates, in this order:
 *
 *   1. SHAPE   — `parseVoiceOutput` (zod). Three touches, numbered 1-2-3. Length caps.
 *   2. CLOSURE — `citationClosure`. Every evidence id the prose names was in its input.
 *   3. TRUTH   — `lintVoice`. No digit the evidence never contained. No AI house style.
 *
 * A brief that fails any gate is REGENERATED ONCE, with the specific failures handed back
 * as an edit list. A second failure is not retried: the evidence cannot support the brief,
 * and a third identical roll of the dice is not a strategy. Nothing is persisted, the
 * practice keeps no brief, and the caller is told why. That is the same line D2 draws for
 * facts, applied to prose — a brief that states an unprovable number must not ship.
 *
 * ON THE RETRY BEING A FRESH REQUEST, not a conversation turn: a multi-turn retry would
 * have to echo the assistant's thinking blocks back unchanged (adaptive thinking is on),
 * and dropping them risks a 400. One turn, no replay, and the prompt's stable prefix is
 * untouched. Each attempt is separately billed and separately metered (R19) — `meta.attempt`
 * on the cost row is how a cohort run measures whether the prompt and the lint agree.
 */

export interface SynthesizeDeps {
  db: Database;
  client: VoiceClient;
  meter: Meter;
  /** Injected clock. Decides which signals are fresh, and stamps `generated_at`. */
  now?: () => Date;
  logger?: (event: string, meta?: Record<string, unknown>) => void;
}

/** An evidence id the prose cited that was never in its input. Fabricated attribution. */
export interface UnknownCitation {
  evidenceId: string;
}

export type SynthesizeResult =
  | {
      status: "generated" | "regenerated";
      practiceId: string;
      briefId: string;
      /** 1 when the first attempt passed all three gates. 2 means the retry saved it. */
      attempts: number;
      zeroSignal: boolean;
      contactVariant: "named" | "role_only" | "none";
      signalCount: number;
    }
  | {
      status: "failed";
      practiceId: string;
      reason: string;
      attempts: number;
      /**
       * The gate that rejected the last attempt. Distinct causes need distinct fixes, and
       * a cohort run reads this to tell "the model is drifting" (`truth`) from "Anthropic
       * is rate-limiting us" (`transport`) from "this practice was never briefable"
       * (`input`). Only `transport` is worth retrying later, unchanged.
       */
      gate: "input" | "shape" | "closure" | "truth" | "transport";
    };

function defaultLogger(event: string, meta?: Record<string, unknown>): void {
  console.warn(event, meta ?? {});
}

/**
 * Which cited ids were not in the input?
 *
 * The prompt hands the model an EVIDENCE block whose ids are the only ids anywhere in its
 * context, so inventing one takes real effort. It has happened: U5's citation verifier
 * caught the same model class stitching a snippet on a live production call, and the
 * fabrication did not reproduce on a re-run with identical input. A defect that appears
 * stochastically cannot be caught by reading the output or by tightening the prompt. It is
 * caught by checking, on every call.
 */
export function citationClosure(voice: VoiceBrief, allowed: ReadonlySet<string>): UnknownCitation[] {
  return [...new Set(referencedEvidenceIds(voice))]
    .filter((id) => !allowed.has(id))
    .map((evidenceId) => ({ evidenceId }));
}

/**
 * A brief whose buying moment fired MUST attribute its headline to a signal.
 *
 * Without this, the model can satisfy citation closure by citing a firmographic fact for
 * the headline — "Founded in 2004" attributed to the About page — and the card's whole
 * spine (D1: "the timing thesis is the visible spine of the product") quietly becomes a
 * profile blurb with no timing in it. Closure checks that a citation is REAL; this checks
 * that it is RELEVANT.
 */
export function headlineCitesASignal(
  voice: VoiceBrief,
  signalRows: readonly SignalRow[],
): boolean {
  const signalEvidence = new Set(signalRows.map((row) => row.evidence.id));
  return voice.headlineEvidenceIds.some((id) => signalEvidence.has(id));
}

/** Closure + relevance failures, phrased as an edit list the next attempt can act on. */
function closureCorrections(
  unknown: readonly UnknownCitation[],
  headlineMissesSignal: boolean,
): string[] {
  const corrections = unknown.map(
    (u) =>
      `- you cited evidence id "${u.evidenceId}", which was not in the EVIDENCE block. Cite only the ids given, and only for sentences they support.`,
  );
  if (headlineMissesSignal) {
    corrections.push(
      "- headlineEvidenceIds must include at least one SIGNAL id. The headline is the buying moment, not the practice profile.",
    );
  }
  return corrections;
}

interface AttemptOutcome {
  voice: VoiceBrief | null;
  gate: "shape" | "closure" | "truth" | "transport";
  reason: string;
  corrections: string[];
  /**
   * A THROWN call was never billed — a 429, a timeout, a socket that died before headers.
   * It tells us nothing about the practice, so retrying it immediately would answer a rate
   * limit by spending money on the same rate limit. The loop stops and the caller decides
   * when to come back. (Same reasoning as `waterfall.ts`'s `thrown` flag: a transient
   * transport failure and a bad result are different facts and deserve different handling.)
   */
  retryable: boolean;
}

async function attemptVoice(
  deps: SynthesizeDeps,
  input: BriefInput,
  factual: FactualBrief,
  signals: SignalRow[],
  corrections: readonly string[],
  attempt: number,
): Promise<AttemptOutcome> {
  let outcome: Awaited<ReturnType<typeof runVoice>>;
  try {
    outcome = await runVoice(
      { client: deps.client, meter: deps.meter, practiceId: input.practice.id },
      {
        practice: input.practice,
        facts: input.facts,
        signals,
        contact: input.contact,
        pack: input.pack,
        zeroSignal: factual.zeroSignal,
        corrections,
      },
      attempt,
    );
  } catch (err) {
    // Gate 0 — TRANSPORT. A non-2xx throws (correctly: it is unbilled, and the meter records
    // nothing). It must not take a whole seeding run down with it, and it must be
    // distinguishable from a BAD RESULT — only the latter is evidence about the practice.
    // Never retried, never persisted, never silently swallowed: logged with its message.
    return {
      voice: null,
      gate: "transport",
      reason: err instanceof Error ? err.message : String(err),
      corrections: [],
      retryable: false,
    };
  }

  // Gate 1 — SHAPE. A billed 200 whose body is malformed is a resolved result, never a
  // throw: the meter has already written its row and the money is already gone.
  if (!outcome.ok) {
    return {
      voice: null,
      gate: "shape",
      reason: outcome.reason,
      corrections: [`- your output did not parse: ${outcome.reason}. Return only the JSON object, and respect every length ceiling.`],
      retryable: true,
    };
  }

  const voice = outcome.voice;

  // Gate 2 — CLOSURE. Attribution must be real, and the headline's must be relevant.
  const unknown = citationClosure(voice, allowedEvidenceIds(input.facts, signals));
  const headlineMissesSignal = !factual.zeroSignal && !headlineCitesASignal(voice, signals);
  if (unknown.length > 0 || headlineMissesSignal) {
    return {
      voice: null,
      gate: "closure",
      reason:
        unknown.length > 0
          ? `cited ${unknown.length} evidence id(s) not present in the input`
          : "headline does not cite a signal",
      corrections: closureCorrections(unknown, headlineMissesSignal),
      retryable: true,
    };
  }

  // Gate 3 — TRUTH. The corpus is built from the SAME inputs the model was shown; a wider
  // one lets a fabrication pass, a narrower one rejects a true fact.
  const lint = lintVoice(voice, buildGroundingCorpus(groundingParts(input)));
  if (!lint.ok) {
    return {
      voice: null,
      gate: "truth",
      reason: summarizeViolations(lint.violations),
      corrections: [formatViolations(lint.violations)],
      retryable: true,
    };
  }

  return { voice, gate: "truth", reason: "", corrections: [], retryable: true };
}

function summarizeViolations(violations: readonly Violation[]): string {
  const byKind = new Map<string, number>();
  for (const v of violations) byKind.set(v.kind, (byKind.get(v.kind) ?? 0) + 1);
  return [...byKind].map(([kind, n]) => `${kind} x${n}`).join(", ");
}

/**
 * Generate and persist one practice's brief.
 *
 * Fails honestly rather than degrading: an unclassified practice has no pack, so it has no
 * pitch, and `db/queries.ts#feedPractices` already keeps it out of the feed for the same
 * reason. A practice with zero fired signals gets the zero-signal variant — an honest
 * profile card under "no buying moment detected yet" — never an invented urgency.
 */
export async function synthesizeBrief(
  deps: SynthesizeDeps,
  practiceId: string,
): Promise<SynthesizeResult> {
  const now = deps.now ?? (() => new Date());
  const log = deps.logger ?? defaultLogger;

  const built = await buildBriefInput(deps.db, practiceId);
  if (!built.ok) {
    log("brief.input_failed", { practiceId, reason: built.reason });
    return { status: "failed", practiceId, reason: built.reason, attempts: 0, gate: "input" };
  }

  const input = built.input;
  const generatedAt = now();
  const { factual, signals } = assembleFactual(input, generatedAt);

  let corrections: string[] = [];
  // Seeded, not nullable. A `let last: AttemptOutcome | null` would need a cast to read
  // after the loop, and a cast over a possible null is precisely the kind of error-hiding
  // this repo forbids — it would also become a real crash the day `VOICE_MAX_ATTEMPTS` is
  // set to 0. Seeding it means the "no attempt ran" state is representable and honest.
  let last: AttemptOutcome = {
    voice: null,
    gate: "transport",
    reason: `no attempt made (VOICE_MAX_ATTEMPTS=${VOICE_MAX_ATTEMPTS})`,
    corrections: [],
    retryable: false,
  };

  for (let attempt = 1; attempt <= VOICE_MAX_ATTEMPTS; attempt += 1) {
    const outcome = await attemptVoice(deps, input, factual, signals, corrections, attempt);
    last = outcome;

    if (outcome.voice) {
      const written = await upsertBrief(deps.db, {
        practiceId,
        factual,
        voice: outcome.voice,
        now: generatedAt,
      });
      return {
        status: written.status,
        practiceId,
        briefId: written.briefId,
        attempts: attempt,
        zeroSignal: factual.zeroSignal,
        contactVariant: factual.contact?.variant ?? "none",
        signalCount: new Set(signals.map((s) => s.kind)).size,
      };
    }

    // Loud on every rejection. The drop KINDS are the prompt-drift early-warning signal —
    // a `truth` gate that starts firing across a cohort means the prompt moved, not that
    // the practices got shifty. Same reasoning as `enrich.citation_drops` in U5.
    log("brief.attempt_rejected", {
      practiceId,
      practice: input.practice.name,
      attempt,
      gate: outcome.gate,
      reason: outcome.reason,
    });

    // An unbilled transport failure is not evidence about this practice, and a second
    // identical call would answer a 429 by paying for another 429. Stop; the caller retries.
    if (!outcome.retryable) {
      return {
        status: "failed",
        practiceId,
        reason: outcome.reason,
        attempts: attempt,
        gate: outcome.gate,
      };
    }
    corrections = outcome.corrections;
  }

  return {
    status: "failed",
    practiceId,
    reason: last.reason,
    attempts: VOICE_MAX_ATTEMPTS,
    gate: last.gate,
  };
}
