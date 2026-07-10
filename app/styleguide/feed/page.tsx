import type { Metadata } from "next";
import { PageContainer, TopNav } from "@/design/components";
import { gradients } from "@/design/tokens";
import { Feed } from "../../feed";
import { demoFeedItems } from "../demo-fixtures";

export const metadata: Metadata = {
  title: "Feed (populated) · GTM Maestro",
};

/**
 * Design-review preview of U8's feed, populated with illustrative fixtures.
 *
 * This is the SAME `<Feed>` and the SAME page frame as `app/page.tsx` — only the
 * data source differs (fixtures here, Postgres there), so the pixels match the live
 * page exactly. It lives under `/styleguide/` because that prefix is public in dev
 * (see `src/lib/auth.ts`), and it reads no database.
 */
export default function FeedPreviewPage() {
  const items = demoFeedItems();
  return (
    <div
      className="flex flex-1 flex-col"
      style={{ backgroundImage: gradients.healthHero }}
    >
      <TopNav tone="dark" />
      <main className="flex flex-1 flex-col">
        <PageContainer className="py-8">
          <Feed items={items} />
        </PageContainer>
      </main>
    </div>
  );
}
