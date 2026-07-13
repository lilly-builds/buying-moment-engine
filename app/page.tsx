import { getDb } from "@/db/client";
import { dashboardFeedPractices } from "@/db/queries";
import { isFresh } from "@/src/engine/freshness";
import { toVerticalSlug } from "@/src/ui/signal-display";
import { PageContainer, TopNav } from "@/design/components";
import { gradients } from "@/design/tokens";
import { Feed, type FeedItem } from "./feed";

// Read live data at request time — never at build time — so `next build` and a
// keyless deploy both succeed and render the (designed, empty) feed.
export const dynamic = "force-dynamic";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The push feed home (U8). Server component: it does the one query and shapes the
 * rows; the `<Feed>` client island filters and renders. Time-sensitive values
 * (age, freshness) are computed HERE against a single `now`, so a row cannot
 * disagree with itself between the count and the clock.
 */
async function loadFeed(): Promise<FeedItem[]> {
  const now = new Date();
  let rows;
  try {
    rows = await dashboardFeedPractices(getDb(), now);
  } catch {
    // No DATABASE_URL, or the DB is unreachable -> the designed empty state, never
    // a crash. The demo must render on a keyless clone.
    return [];
  }

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    vertical: toVerticalSlug(row.vertical),
    signalKinds: row.signals.map((signal) => signal.kind),
    freshestAgeDays: Math.max(
      0,
      Math.floor((now.getTime() - row.freshest.detectedAt.getTime()) / DAY_MS),
    ),
    freshestKind: row.freshest.kind,
    freshestIsFresh: isFresh(row.freshest.expiresAt, now),
  }));
}

export default async function Home() {
  const items = await loadFeed();

  return (
    // The health-blue hero is the WHOLE page now, not a card in a white margin:
    // the gradient paints edge-to-edge behind the (transparent, backdrop-blurred)
    // nav and the feed, exactly the "over a health-blue hero" surface the styleguide
    // mounts the dark nav on. `flex-1` lets it stretch past the fold when the feed
    // is long, so the gradient never stops short of the last row.
    <div
      className="flex flex-1 flex-col"
      style={{ backgroundImage: gradients.healthHero }}
    >
      {/* Dark tone: white logo + nav ink and a hairline that reads on blue. */}
      <TopNav tone="dark" />
      <main className="flex flex-1 flex-col">
        {/* Content density, not marketing rhythm: the feed breathes at gap-8, not
            py-section. PageContainer keeps it on the same 1280px edge as the nav. */}
        <PageContainer className="py-8">
          <Feed items={items} />
        </PageContainer>
      </main>
    </div>
  );
}
