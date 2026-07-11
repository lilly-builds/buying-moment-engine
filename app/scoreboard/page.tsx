import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { isAllowlistedRequest } from "@/src/lib/auth-guard";
import { getActiveWorkspace } from "@/src/workspace/active";
import { ScoreboardView } from "../scoreboard-view";
import { TenantScoreboardView } from "../tenant-scoreboard-view";
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
  // A tenant workspace must NOT see EliseAI's global roi_events (they are EliseAI's
  // own performance). It gets the honest "fills in as you work leads" board instead;
  // only the synthetic default (id === "default") shows the real aggregated numbers.
  const workspace = await getActiveWorkspace();
  if (workspace.id !== "default") {
    return <TenantScoreboardView productName={workspace.config.brand.productName} />;
  }

  // Belt-and-suspenders (R18): this is the DEFAULT/EliseAI branch, which
  // aggregates real roi_events. The proxy's tenant-cookie allowance opens
  // /scoreboard so a tenant sees ITS OWN honest board above — it never
  // authorizes this real-data branch. Re-check the allowlist so a forged/stale
  // active_workspace cookie can never reach real performance data.
  if (!(await isAllowlistedRequest())) {
    redirect("/login");
  }

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
