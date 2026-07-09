import { getDb } from "@/db/client";
import { getBrief } from "@/db/brief";
import { practiceSignalRows } from "@/db/queries";
import { renderBrief } from "@/src/brief/render";
import type { SignalRow } from "@/src/brief/inputs";
import { ButtonLink, Card, PageContainer, SectionHeader, TopNav } from "@/design/components";
import { gradients } from "@/design/tokens";
import { BriefView } from "../../brief-view";

// Read the stored brief at request time — never at build time — so `next build` and a
// keyless clone both succeed and the (designed) "no brief yet" state renders instead of
// crashing. Same contract as `app/page.tsx`.
export const dynamic = "force-dynamic";

/**
 * The deep-brief detail page (U9). The feed's "View brief" links here as `/practice/{id}`.
 *
 * Server component: it reads the STORED brief (`getBrief`) and the live signal rows
 * (`practiceSignalRows`), then `renderBrief` merges them so the time-sensitive fields —
 * fired-signal list, freshness, headline — are computed fresh against a single `now`,
 * never trusted from the stored JSON. The `<BriefView>` client island only renders.
 *
 * All three `getBrief` outcomes resolve to a designed screen, never a throw:
 *   - `found`      → the brief.
 *   - `missing`    → "No brief yet" (no row for this practice).
 *   - `unreadable` → "can't be displayed" (a row whose JSON no longer parses — a real bug
 *                    we surface loudly rather than fold into `missing`; the reason is logged
 *                    server-side, not leaked to the AE).
 */
export default async function PracticeBriefPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const now = new Date();

  let result;
  try {
    result = await getBrief(getDb(), id);
  } catch {
    // No DATABASE_URL, or the DB is unreachable -> the designed empty state, never a
    // crash. The demo must render on a keyless clone (matches `app/page.tsx#loadFeed`).
    return (
      <BriefUnavailable
        title="No brief yet"
        body="We couldn't reach the brief for this practice. Once a practice hits a buying moment and a brief is generated, it shows up here."
      />
    );
  }

  if (result.status === "missing") {
    return (
      <BriefUnavailable
        title="No brief yet"
        body="We haven't generated a deep brief for this practice yet. Briefs are built when a practice hits a buying moment on the feed."
      />
    );
  }

  if (result.status === "unreadable") {
    // LOUD server-side (a schema drift is our bug), quiet and honest for the AE.
    console.error(`brief ${result.briefId} is unreadable: ${result.reason}`);
    return (
      <BriefUnavailable
        title="This brief can't be displayed"
        body="The stored brief no longer matches the current format and needs to be regenerated. We've logged it."
      />
    );
  }

  // Time-sensitive fields are read live from `signals`; a DB hiccup here degrades to the
  // zero-signal view rather than a 500 — the stored prose still renders honestly.
  let signalRows: SignalRow[] = [];
  try {
    signalRows = await practiceSignalRows(getDb(), id);
  } catch {
    signalRows = [];
  }

  const rendered = renderBrief(result.brief, signalRows, now);
  return <BriefView brief={rendered} nowMs={now.getTime()} practiceId={id} />;
}

/**
 * A designed stand-in for the two non-`found` states, on the SAME health-blue surface as
 * the feed and the brief so the AE never lands on a bare error. Composed from the kit —
 * no new component, no restyle of the approved brief.
 */
function BriefUnavailable({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex flex-1 flex-col" style={{ backgroundImage: gradients.healthHero }}>
      <TopNav tone="dark" />
      <main className="flex flex-1 flex-col">
        <PageContainer className="flex flex-1 items-center justify-center py-16">
          <Card variant="elevated" padding="lg" className="max-w-lg">
            <div className="flex flex-col items-start gap-5">
              <SectionHeader eyebrow="Deep brief" title={title} size="h3" as="h1" />
              <p className="font-sans text-base text-ink-muted">{body}</p>
              <ButtonLink href="/" variant="secondary" size="md">
                Back to the feed
              </ButtonLink>
            </div>
          </Card>
        </PageContainer>
      </main>
    </div>
  );
}
