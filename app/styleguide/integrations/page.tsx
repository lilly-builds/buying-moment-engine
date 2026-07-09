import type { Metadata } from "next";
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
 * Toggle the fixtures from the URL so both states are reviewable:
 *   /styleguide/integrations                    -> disconnected (the Connect CTA)
 *   /styleguide/integrations?state=connected     -> connected (portal + capabilities)
 *   /styleguide/integrations?banner=connected     -> the post-OAuth success banner
 *   /styleguide/integrations?banner=error          -> a failed-connect banner
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
      ? { state: "connected" }
      : { state: "disconnected" };

  const banner: ConnectBanner | null =
    bannerParam === "connected"
      ? { kind: "connected" }
      : bannerParam === "error"
        ? { kind: "error", code: "connect_failed" }
        : null;

  return <IntegrationsView hubspot={hubspot} banner={banner} />;
}
