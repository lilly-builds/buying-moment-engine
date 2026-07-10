import { ButtonLink, Card } from "@/design/components";
import { gradients } from "@/design/tokens";
import { StepIcon } from "@/design/components/onboarding/step-icon";
import { describeLeadValue } from "@/src/connect/connections";

/**
 * ValueOpener — the "why" before the setup (Thread 08 · onboarding-design §1,
 * "full value before a single key").
 *
 * A RevOps owner lands on the payoff their team ALREADY has, not a form: the real
 * hot-lead count (never a hardcoded string) + a one-tap "open a real brief" — the
 * single most persuasive artifact. The ask is framed honestly: everything works
 * now; their keys unlock only the last inch (a real send into their systems).
 *
 * Deliberately NO "N reps are waiting" demand line — there's no real cross-user
 * count yet, and a fabricated one is the number this thread's brief forbids
 * (ship-today decision, 2026-07-10). The honest number is the lead count.
 *
 * Pure presentation (no state) — rendered inside the client IntegrationsView, so
 * it needs no "use client" of its own.
 */
export function ValueOpener({
  leadCount,
  firstBriefHref,
}: {
  leadCount: number;
  firstBriefHref: string | null;
}) {
  const value = describeLeadValue(leadCount);
  // A real brief when the feed has one; otherwise the live feed itself — never a
  // dead link, and never a fabricated number.
  const ctaHref = firstBriefHref ?? "/";
  const ctaLabel = firstBriefHref ? "Open a live brief" : "See the live feed";

  return (
    <Card variant="elevated" padding="lg">
      <div className="flex flex-col gap-6">
        <div className="flex items-start gap-4">
          <span
            className="flex size-14 shrink-0 items-center justify-center rounded-pill text-white shadow-soft"
            style={{ backgroundImage: gradients.orb }}
          >
            <StepIcon icon="rank" />
          </span>
          <div className="flex flex-col gap-3">
            <h2 className="font-display text-h3 font-book leading-tight tracking-brand text-ink text-balance">
              {value.hasLeads ? (
                <>
                  Your reps already have{" "}
                  <span className="text-brand">{value.phrase}</span> with full
                  call prep — researched, written, ready.
                </>
              ) : (
                <>
                  Your reps&apos; live feed is ready — real practices at a buying
                  moment, researched and written up.
                </>
              )}
            </h2>
            <p className="max-w-xl font-sans text-lg text-ink-body">
              Turning on sending and CRM tracking takes about{" "}
              <span className="font-semibold text-ink">5 minutes</span> and one
              connection.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-4 sm:pl-[4.5rem]">
          <ButtonLink href={ctaHref} variant="primary">
            {ctaLabel}
          </ButtonLink>
          <p className="font-sans text-sm text-ink-muted">
            Everything works right now. Your keys unlock the last inch — firing a
            real send into your systems.
          </p>
        </div>
      </div>
    </Card>
  );
}
