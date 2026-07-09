import type { Metadata } from "next";
import { BriefView } from "../../brief-view";
import { demoBrief } from "../demo-fixtures";

export const metadata: Metadata = {
  title: "Brief (populated) · GTM Maestro",
};

/**
 * Design-review preview of U9's deep brief, populated with illustrative fixtures
 * (real, verified pack citations — see `demo-fixtures.ts`). Same `<BriefView>` the
 * live `app/practice/[id]/page.tsx` renders; only the data source differs. Public in
 * dev via the `/styleguide/` prefix; reads no database.
 */
export default function BriefPreviewPage() {
  const now = new Date();
  return <BriefView brief={demoBrief(now)} nowMs={now.getTime()} />;
}
