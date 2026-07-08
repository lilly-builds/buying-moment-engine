import type { ReactNode } from "react";
import { cn } from "@/design/lib/cn";
import { Badge } from "./badge";

/**
 * StatTile (U12) — the KPI figure. The ROI scoreboard leads with numbers, and a
 * number is a form, not a chart (dataviz: "is it even a chart?"). Each tile is a
 * label, one big value, an optional signed delta, and the D10 honesty tag that says
 * whether the number is MEASURED (real, from the tool) or MODELED (projected from
 * public benchmarks).
 *
 * The value renders in `font-display` (Inter Tight 450) on purpose: that is
 * EliseAI's own treatment for a headline stat — their "proof in the results" band
 * sets "88%" and "3+ hrs" in the display face. The generic dataviz rule ("hero
 * numbers in the body sans") guards against an arbitrary decorative face; here the
 * display face IS the brand, so it is on-brand, not decoration.
 *
 * `caption` carries R3's discipline — every metric names the move it drives, so the
 * scoreboard is a set of decisions, not a wall of numbers.
 */

export type StatHonesty = "measured" | "modeled";
export type StatDelta = "positive" | "negative" | "neutral";

export interface StatTileProps {
  /** Sentence case, no trailing colon. */
  label: string;
  /** Pre-formatted and compacted by the caller: "1,284" / "$58" / "42%". */
  value: string;
  /** Signed, vs a named period, e.g. "+18% vs last month". */
  delta?: string;
  /** Semantic direction — the caller decides, because down is good for cost. */
  deltaTone?: StatDelta;
  honesty?: StatHonesty;
  /** The loop it powers + the move it drives (R3). Quiet, beneath the number. */
  caption?: ReactNode;
  className?: string;
}

// Colour carries only good/bad; the delta STRING carries direction (it is signed).
// Tying an arrow to the tone contradicts a "good" metric that fell — e.g. cost −18%.
const DELTA_INK: Record<StatDelta, string> = {
  positive: "text-success-ink",
  negative: "text-danger",
  neutral: "text-ink-muted",
};

// The honesty tag is a real data chip → the mono Badge. Everything ELSE on the tile
// is prose (Inter): the label was a made-up mono-uppercase descriptor and read as
// illegible fine print. Mono is reserved for count chips, not labels (design/tokens).
const HONESTY_LABEL: Record<StatHonesty, string> = {
  measured: "Measured",
  modeled: "Modeled",
};

export function StatTile({
  label,
  value,
  delta,
  deltaTone = "neutral",
  honesty,
  caption,
  className,
}: StatTileProps) {
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="flex items-center justify-between gap-3">
        <span className="font-sans text-base font-medium text-ink-strong">
          {label}
        </span>
        {honesty ? (
          <Badge tone="neutral" size="sm">
            {HONESTY_LABEL[honesty]}
          </Badge>
        ) : null}
      </div>

      <span className="font-display text-h2 font-book tracking-brand text-ink">
        {value}
      </span>

      {delta ? (
        <span className={cn("font-sans text-sm", DELTA_INK[deltaTone])}>{delta}</span>
      ) : null}

      {caption ? (
        <p className="mt-1 font-sans text-sm text-ink-muted">{caption}</p>
      ) : null}
    </div>
  );
}
