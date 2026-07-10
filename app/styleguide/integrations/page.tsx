import type { Metadata } from "next";
import { resolveTarget } from "@/src/target/config";
import {
  IntegrationsView,
  type ConnectBanner,
  type HubSpotStatus,
} from "../../integrations/integrations-view";

export const metadata: Metadata = {
  title: "Integrations (preview) · GTM Maestro",
};

/**
 * Design-review preview of U17's Connections page. Same `<IntegrationsView>` the
 * live `app/integrations/page.tsx` renders — only the data source differs
 * (fixtures here, the real connection there), so the pixels match. Public in dev
 * via the `/styleguide/` prefix; reads no database.
 *
 * Toggle the fixtures from the URL so every state is reviewable:
 *   /styleguide/integrations                       -> disconnected (Connect CTA; opener with real N)
 *   ?state=connected                               -> connected, no sequence yet ("Almost — set up your sequence")
 *   ?state=connected&seq=1                          -> connected + sequence set ("You're live", all green)
 *   ?leads=0                                        -> the degraded opener (no hot leads → feed link)
 *   ?banner=connected                              -> the post-OAuth success banner
 *   ?banner=error                                  -> a failed-connect banner
 */

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

type PreviewProps = {
  searchParams?:
    | Promise<Record<string, string | string[] | undefined>>
    | Record<string, string | string[] | undefined>;
};

export default async function IntegrationsPreviewPage({
  searchParams,
}: PreviewProps) {
  const params = searchParams ? await searchParams : {};
  const state = firstParam(params.state);
  const bannerParam = firstParam(params.banner);

  const hubspot: HubSpotStatus =
    state === "connected"
      ? // `?state=connected` previews a portal that still needs its sequence id;
        // `?state=connected&seq=1` previews one already set (fully live).
        { state: "connected", sequenceId: firstParam(params.seq) ? "712515259" : null }
      : { state: "disconnected" };

  const banner: ConnectBanner | null =
    bannerParam === "connected"
      ? { kind: "connected" }
      : bannerParam === "error"
        ? { kind: "error", code: "connect_failed" }
        : null;

  // Opener fixtures: `?leads=0` previews the honest degraded copy (no number),
  // otherwise a representative real count + a sample first-brief link. The link
  // points at the PUBLIC brief preview so this design-review page is fully
  // walkable without auth (the live /integrations uses a real practice id).
  const noLeads = firstParam(params.leads) === "0";
  const leadCount = noLeads ? 0 : 12;
  const firstBriefHref = noLeads ? null : "/styleguide/brief";
  const owner = resolveTarget(process.env).revOpsOwner;

  return (
    <IntegrationsView
      hubspot={hubspot}
      banner={banner}
      owner={owner}
      leadCount={leadCount}
      firstBriefHref={firstBriefHref}
    />
  );
}
