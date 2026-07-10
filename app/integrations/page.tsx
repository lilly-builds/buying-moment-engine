import type { Metadata } from "next";
import { getDb } from "@/db/client";
import { getActiveConnection } from "@/db/crm";
import { hasProviderCredential } from "@/db/integrations";
import {
  IntegrationsView,
  type ConnectBanner,
  type EngineKeyStatus,
  type HubSpotStatus,
} from "./integrations-view";

// Read the connection live at request time — never at build — so `next build`
// and a keyless clone both render the (designed) disconnected state instead of
// crashing. Same contract as `app/page.tsx` and `app/scoreboard/page.tsx`.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Integrations · GTM Maestro",
  description:
    "Connect HubSpot and the rest of your stack — surfaced leads push, tag, and track where your team already works.",
};

/** Resolve the live HubSpot connection, degrading to disconnected on any failure. */
async function loadHubSpotStatus(): Promise<HubSpotStatus> {
  try {
    const result = await getActiveConnection(getDb());
    if (result.ok) return { state: "connected" };
    // "none" or "ambiguous" — both render as Connect; ambiguous is an ops edge.
    return { state: "disconnected" };
  } catch {
    // No DATABASE_URL / DB unreachable -> the designed disconnected state.
    return { state: "disconnected" };
  }
}

/**
 * A key reads "present" when EITHER a real key is stored (pasted by RevOps) OR the
 * env fallback is set (the keyless demo runs on Lilly's env keys — "full value
 * before a single key," D14). The stored check degrades to false on any DB failure
 * so the page always renders; the env fallback is unaffected.
 */
async function loadEngineKeys(): Promise<EngineKeyStatus> {
  async function present(provider: "anthropic" | "pdl", envVar: string): Promise<boolean> {
    if (process.env[envVar]) return true;
    try {
      return await hasProviderCredential(getDb(), provider);
    } catch {
      return false;
    }
  }
  const [anthropic, pdl] = await Promise.all([
    present("anthropic", "ANTHROPIC_API_KEY"),
    present("pdl", "PDL_API_KEY"),
  ]);
  return { anthropic, pdl };
}

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

type IntegrationsPageProps = {
  searchParams?:
    | Promise<Record<string, string | string[] | undefined>>
    | Record<string, string | string[] | undefined>;
};

/**
 * /integrations — the Connections page (U17). Server component: it resolves the
 * HubSpot status and the post-OAuth banner (from the `?connected` / `?error` the
 * callback route redirects back with), then hands both to the view island.
 */
export default async function IntegrationsPage({
  searchParams,
}: IntegrationsPageProps) {
  const params = searchParams ? await searchParams : {};
  const connected = firstParam(params.connected);
  const error = firstParam(params.error);

  // The callback only ever sends `connected=hubspot`; anything else isn't a real
  // success and must not paint the success banner.
  const banner: ConnectBanner | null =
    connected === "hubspot"
      ? { kind: "connected" }
      : error
        ? { kind: "error", code: error }
        : null;

  const hubspot = await loadHubSpotStatus();

  // The two BYOK engine keys (spec § Stack): present when a real key is stored OR
  // the env fallback is set. In the demo these run on Lilly's own keys ("full
  // value before a single key"), so they read set while HubSpot — which needs
  // EliseAI's own OAuth — stays the one gate left to turn on.
  const engineKeys = await loadEngineKeys();

  return <IntegrationsView hubspot={hubspot} engineKeys={engineKeys} banner={banner} />;
}
