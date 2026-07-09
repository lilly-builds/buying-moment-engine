import { getDb } from "@/db/client";
import { ScoreboardView } from "../scoreboard-view";
import { emptyScoreboardData, loadScoreboardData } from "./data";

// Aggregate live at request time — never at build time — so `next build` and a keyless
// clone both succeed and render the (designed, all-zero) scoreboard. Same contract as
// `app/page.tsx`.
export const dynamic = "force-dynamic";

/**
 * The ROI scoreboard (U12). The nav's "Scoreboard" link lands here.
 *
 * Server component: it aggregates `roi_events` + `cost_events` (+ the AE `feedback` and
 * `crm_links` the tool writes) into the `ScoreboardData` the `<ScoreboardView>` client
 * island toggles and renders. The honesty tags (measured vs modeled) are decided in the
 * data layer (`./data`), not the view.
 */
export default async function ScoreboardPage() {
  let data;
  try {
    data = await loadScoreboardData(getDb());
  } catch {
    // No DATABASE_URL, or the DB is unreachable -> the designed all-zero scoreboard, never
    // a crash. The demo must render on a keyless clone (matches `app/page.tsx#loadFeed`).
    data = emptyScoreboardData();
  }

  return <ScoreboardView data={data} />;
}
