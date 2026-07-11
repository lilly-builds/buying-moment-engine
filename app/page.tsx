import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { feedPractices } from "@/db/queries";
import { isFresh } from "@/src/engine/freshness";
import { isAllowlistedRequest } from "@/src/lib/auth-guard";
import { toVerticalSlug } from "@/src/ui/signal-display";
import { getActiveWorkspace } from "@/src/workspace/active";
import { PageContainer, TopNav } from "@/design/components";
import { Feed, type FeedItem } from "./feed";
import { TenantFeed } from "./tenant-feed";

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
    rows = await feedPractices(getDb(), now);
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
  // A tenant workspace (id !== "default") with a generated sample feed renders THAT
  // feed, wearing its own brand; the synthetic EliseAI default (id === "default")
  // still renders the real practices feed below, unchanged. The whole page surface,
  // nav, and container are identical either way — only the rows differ.
  const workspace = await getActiveWorkspace();
  const sampleFeed = workspace.config.sampleFeed;
  if (workspace.id !== "default" && sampleFeed.length > 0) {
    return (
      <div className="gradient-hero-calm flex flex-1 flex-col">
        <TopNav tone="dark" />
        <main className="flex flex-1 flex-col">
          <PageContainer className="py-8">
            <TenantFeed
              prospects={sampleFeed}
              productName={workspace.config.brand.productName}
            />
          </PageContainer>
        </main>
      </div>
    );
  }

  // Belt-and-suspenders (R18): this is the DEFAULT branch, which renders
  // EliseAI's real practices feed. The proxy's tenant-cookie allowance only
  // opens "/" so a tenant's own onboarding can render its sample feed above —
  // it never authorizes the real feed below. Re-check the allowlist here so a
  // forged/stale active_workspace cookie (or a bug in the workspace resolver)
  // can never reach real business-contact data.
  if (!(await isAllowlistedRequest())) {
    redirect("/login");
  }

  const items = await loadFeed();

  return (
    // The health-blue hero is the WHOLE page now, not a card in a white margin:
    // the gradient paints edge-to-edge behind the (transparent, backdrop-blurred)
    // nav and the feed, exactly the "over a health-blue hero" surface the styleguide
    // mounts the dark nav on. `flex-1` lets it stretch past the fold when the feed
    // is long, so the gradient never stops short of the last row.
    <div className="gradient-hero-calm flex flex-1 flex-col">
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
