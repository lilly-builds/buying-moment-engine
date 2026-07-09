import type { Metadata } from "next";
import { ScoreboardView } from "../../scoreboard-view";
import { demoScoreboard } from "../demo-fixtures";

export const metadata: Metadata = {
  title: "Scoreboard (populated) · GTM Maestro",
};

/**
 * Design-review preview of U12's ROI scoreboard, populated with illustrative
 * fixtures (D10 honesty tags kept honest — see `demo-fixtures.ts`). Same
 * `<ScoreboardView>` the live `app/scoreboard/page.tsx` renders; only the data
 * source differs. Public in dev via the `/styleguide/` prefix; reads no database.
 */
export default function ScoreboardPreviewPage() {
  return <ScoreboardView data={demoScoreboard()} />;
}
