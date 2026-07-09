import type { Recipient, SendAdapter } from "./adapter";

/**
 * The APP-owned 3-touch cadence (R10, U11) — light throttling + reply-detection.
 * The spec is explicit that OUR app owns the schedule, not HubSpot's Sequence
 * scheduler: each touch is one immediate-send enrollment, and this module decides
 * WHEN touches 2 and 3 fire and halts the moment the prospect replies.
 *
 * The decision logic is PURE (validate · plan · select-due); the single
 * orchestrator `advanceCadence` injects the clock, the reply check, and the send
 * adapter, so it unit-tests with no I/O and no mocks-of-mocks. A scheduler
 * (Inngest tick) calls `advanceCadence` per practice per tick and persists the
 * returned state — that wiring lands with the U15 seeding/scheduler pass; this
 * unit owns the decision, not the cron.
 */

export const TOUCH_COUNT = 3;

const DAY_MS = 24 * 60 * 60 * 1000;
/** touch 1 now · touch 2 at +3 days · touch 3 at +6 days (throttle). */
export const DEFAULT_TOUCH_OFFSETS_MS: readonly number[] = [0, 3 * DAY_MS, 6 * DAY_MS];

export interface SequenceTouch {
  touchNumber: number; // 1..3
  subject: string;
  body: string;
  cta?: string | null;
}

export interface ApprovedSequence {
  touches: SequenceTouch[];
}

export class MalformedSequenceError extends Error {
  constructor(reason: string) {
    super(`Malformed sequence: ${reason}`);
    this.name = "MalformedSequenceError";
  }
}

/**
 * A sequence is sendable only if it is exactly 3 touches numbered 1..3, every
 * touch carries a non-empty body, and the final touch carries the named next-step
 * CTA (R4). Throws BEFORE any network call, so a malformed sequence never sends.
 */
export function validateSequence(sequence: ApprovedSequence): void {
  const touches = sequence.touches ?? [];
  if (touches.length !== TOUCH_COUNT) {
    throw new MalformedSequenceError(
      `expected ${TOUCH_COUNT} touches, got ${touches.length}`,
    );
  }
  const numbers = [...touches].map((t) => t.touchNumber).sort((a, b) => a - b);
  for (let i = 0; i < TOUCH_COUNT; i++) {
    if (numbers[i] !== i + 1) {
      throw new MalformedSequenceError("touch numbers must be exactly 1, 2, 3");
    }
  }
  for (const t of touches) {
    if (!t.subject || t.subject.trim().length === 0) {
      throw new MalformedSequenceError(`touch ${t.touchNumber} has an empty subject`);
    }
    if (!t.body || t.body.trim().length === 0) {
      throw new MalformedSequenceError(`touch ${t.touchNumber} has an empty body`);
    }
  }
  const last = touches.find((t) => t.touchNumber === TOUCH_COUNT);
  if (!last?.cta || last.cta.trim().length === 0) {
    throw new MalformedSequenceError("the final touch must carry a named CTA");
  }
}

export interface ScheduledTouch {
  touchNumber: number;
  scheduledAt: Date;
}

/** Fixed schedule from a start instant + per-touch offsets (pure). */
export function planSchedule(
  startedAt: Date,
  offsetsMs: readonly number[] = DEFAULT_TOUCH_OFFSETS_MS,
): ScheduledTouch[] {
  if (offsetsMs.length !== TOUCH_COUNT) {
    throw new MalformedSequenceError(
      `expected ${TOUCH_COUNT} touch offsets, got ${offsetsMs.length}`,
    );
  }
  return offsetsMs.map((off, i) => ({
    touchNumber: i + 1,
    scheduledAt: new Date(startedAt.getTime() + off),
  }));
}

/**
 * The next touch to send right now, or null if none is due (pure). Touches send
 * strictly in order: touch N is due only when every earlier touch is already sent
 * and its own scheduled time has arrived. `sentTouchNumbers` is the already-sent set.
 */
export function selectDueTouch(
  schedule: readonly ScheduledTouch[],
  now: Date,
  sentTouchNumbers: readonly number[],
): number | null {
  const sent = new Set(sentTouchNumbers);
  for (const s of [...schedule].sort((a, b) => a.touchNumber - b.touchNumber)) {
    if (sent.has(s.touchNumber)) continue;
    // Strict order: the first unsent touch is the only candidate.
    return now.getTime() >= s.scheduledAt.getTime() ? s.touchNumber : null;
  }
  return null;
}

export interface CadenceState {
  startedAt: Date;
  sentTouchNumbers: number[];
}

export interface CadenceDeps {
  now: () => Date;
  /** Reply-detection — true halts the cadence permanently. */
  hasReplied: () => Promise<boolean>;
  adapter: SendAdapter;
  offsetsMs?: readonly number[];
}

export type CadenceAction =
  | { action: "sent"; touchNumber: number }
  | { action: "waiting"; nextTouchNumber: number; nextAt: Date }
  | { action: "halted_reply" }
  | { action: "complete" };

export interface AdvanceResult {
  action: CadenceAction;
  state: CadenceState;
}

/**
 * One cadence step for one recipient. Order of checks is load-bearing:
 *   validate (malformed → zero I/O) → complete? → REPLIED? (halt before sending)
 *   → due? → send exactly one touch.
 * Reply-detection is checked BEFORE selecting/sending a touch, so a prospect who
 * replied never receives a further email.
 */
export async function advanceCadence(
  sequence: ApprovedSequence,
  recipient: Recipient,
  state: CadenceState,
  deps: CadenceDeps,
): Promise<AdvanceResult> {
  validateSequence(sequence);

  const sent = [...state.sentTouchNumbers];
  if (sent.length >= TOUCH_COUNT) {
    return { action: { action: "complete" }, state: { ...state, sentTouchNumbers: sent } };
  }

  if (await deps.hasReplied()) {
    return { action: { action: "halted_reply" }, state: { ...state, sentTouchNumbers: sent } };
  }

  const schedule = planSchedule(state.startedAt, deps.offsetsMs);
  const now = deps.now();
  const due = selectDueTouch(schedule, now, sent);

  if (due === null) {
    const next = schedule.find((s) => !sent.includes(s.touchNumber));
    // `next` is always defined here (sent.length < TOUCH_COUNT), but stay total.
    return next
      ? {
          action: { action: "waiting", nextTouchNumber: next.touchNumber, nextAt: next.scheduledAt },
          state: { ...state, sentTouchNumbers: sent },
        }
      : { action: { action: "complete" }, state: { ...state, sentTouchNumbers: sent } };
  }

  const touch = sequence.touches.find((t) => t.touchNumber === due);
  if (!touch) throw new MalformedSequenceError(`no body for touch ${due}`);
  const namedCta = sequence.touches.find((t) => t.touchNumber === TOUCH_COUNT)?.cta ?? null;

  await deps.adapter.sendTouch({
    recipient,
    touchNumber: due,
    subject: touch.subject,
    body: touch.body,
    cta: namedCta,
  });

  return {
    action: { action: "sent", touchNumber: due },
    state: { ...state, sentTouchNumbers: [...sent, due] },
  };
}
