import { cn } from "@/design/lib/cn";

/**
 * FreshnessClock (U2 / R15) — how old the newest signal is, as a clock face.
 *
 * D7 makes freshness a must-have: "a stale trigger kills the why-now." A number in
 * a chip states that; a clock face *shows* it. The hand sweeps across the freshness
 * window itself, so the metaphor is "how much time is left," not "how old in the
 * abstract": near twelve = just fired, nearly all the way round = about to expire,
 * past the window = red.
 *
 * The threshold lives HERE, not at the call site. A caller that forgets to pass
 * `stale` would silently render an expired lead as fresh — the exact failure D7
 * warns about. Pass `stale` explicitly only to override (e.g. a per-signal-kind
 * window from U3).
 *
 * Colour marks the exception: quiet ink inside the window, red outside it. A healthy
 * row stays colourless.
 *
 * DERIVED: EliseAI has no such component. The ring, hairline, and mono numeral come
 * from verified tokens; the idea is ours.
 */

/** A signal older than this has lost its "why now". */
const STALE_AFTER_DAYS = 7;

export interface FreshnessClockProps {
  /** Age of the freshest signal, in days. */
  days: number;
  /** Override the window. Defaults to 7 days. */
  staleAfterDays?: number;
  /** Override staleness. Defaults to `days > staleAfterDays`. */
  stale?: boolean;
  className?: string;
}

export function FreshnessClock({
  days,
  staleAfterDays = STALE_AFTER_DAYS,
  stale,
  className,
}: FreshnessClockProps) {
  const isStale = stale ?? days > staleAfterDays;

  // The hand sweeps across the freshness window. Capped just short of a full turn:
  // at exactly 360deg it would land back at twelve and an expired signal would look
  // as fresh as one that fired today.
  const progress = Math.max(0, Math.min(days / staleAfterDays, 1));
  const angle = Math.min(progress * 360, 348);

  // Drawn as a tick INSIDE the ring (r 12 -> 16.5) rather than from the centre, so
  // it never crosses the numeral. Starts at twelve, sweeps clockwise.
  const rad = ((angle - 90) * Math.PI) / 180;
  const x1 = 20 + 12 * Math.cos(rad);
  const y1 = 20 + 12 * Math.sin(rad);
  const x2 = 20 + 16.5 * Math.cos(rad);
  const y2 = 20 + 16.5 * Math.sin(rad);

  const title = isStale
    ? `Stale — freshest signal is ${days} days old, past the ${staleAfterDays}-day window`
    : `Freshest signal is ${days} days old`;

  return (
    <div
      className={cn(
        "relative inline-flex size-11 shrink-0 items-center justify-center",
        // `ink-subtle`, not `ink-faint`: at 12px inside a ring the faint grey fell
        // below a legible contrast on the #fafafb card.
        isStale ? "text-danger" : "text-ink-subtle",
        className,
      )}
      title={title}
    >
      <svg viewBox="0 0 40 40" className="absolute inset-0 size-full" aria-hidden="true">
        <circle
          cx="20"
          cy="20"
          r="18.5"
          fill="none"
          stroke="currentColor"
          strokeOpacity={isStale ? 0.55 : 0.28}
          strokeWidth="1"
        />
        <line
          x1={x1.toFixed(2)}
          y1={y1.toFixed(2)}
          x2={x2.toFixed(2)}
          y2={y2.toFixed(2)}
          stroke="currentColor"
          strokeOpacity={isStale ? 0.95 : 0.6}
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </svg>
      <span className="relative font-mono text-xs leading-none">{days}d</span>
      <span className="sr-only">{title}</span>
    </div>
  );
}
