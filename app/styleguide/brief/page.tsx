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
  // A styleguide preview reads no DB, so it can't know a live connection — render the
  // not-connected state (`sendConnected={false}`), which shows the named SendGate
  // handoff rather than a live Send button that would 401/404 for this placeholder id.
  return (
    <BriefView
      brief={demoBrief(now)}
      nowMs={now.getTime()}
      practiceId="styleguide-preview"
      sendConnected={false}
    />
  );
}
