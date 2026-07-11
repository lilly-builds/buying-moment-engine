import { cookies } from "next/headers";
import { ELISEAI_DEFAULT } from "./default";
import type { WorkspaceConfig } from "./schema";
import { getWorkspaceBySlug } from "./store";

/**
 * The active-workspace resolver (Adapt-It P1 — plan § "Active workspace?").
 * Cookie-tracked, server-only: the whole engine reads its brand/pack/signals/
 * pitch/feed from whichever workspace this resolves to, falling back to the
 * existing EliseAI defaults untouched when no workspace is active.
 */
export const ACTIVE_WORKSPACE_COOKIE = "active_workspace";

export interface ActiveWorkspace {
  id: string;
  slug: string;
  name: string;
  config: WorkspaceConfig;
}

/**
 * The synthetic default — NOT a DB row. `id`/`slug` are the literal string
 * "default" (never a real workspace's slug, so it can never collide with one
 * seeded later) so downstream code can tell "no active workspace" apart from
 * "the DB-seeded eliseai workspace" if that distinction ever matters.
 */
const DEFAULT_WORKSPACE: ActiveWorkspace = {
  id: "default",
  slug: "default",
  name: "EliseAI",
  config: ELISEAI_DEFAULT,
};

/**
 * Resolve the active workspace for the current request. Reads the
 * `active_workspace` cookie (Server Components/Route Handlers can always
 * READ cookies — see `node_modules/next/dist/docs/.../cookies.md`); if it
 * names a slug that exists in the DB, that workspace wins. Otherwise —  no
 * cookie, or a slug that isn't in the DB (e.g. it was never seeded, or was
 * later removed) — the synthetic EliseAI default stands, so the existing
 * dashboard is never left with no workspace to render.
 *
 * The DB lookup is wrapped: this runs in the ROOT layout (and every page), so an
 * unreachable DB while a cookie is set must degrade to the default rather than
 * throw and 500 the whole app — the same designed empty-state fallback the feed,
 * scoreboard, and brief already use.
 */
export async function getActiveWorkspace(): Promise<ActiveWorkspace> {
  const store = await cookies();
  const slug = store.get(ACTIVE_WORKSPACE_COOKIE)?.value;
  if (!slug) return DEFAULT_WORKSPACE;

  try {
    const workspace = await getWorkspaceBySlug(slug);
    if (!workspace) return DEFAULT_WORKSPACE;

    return {
      id: workspace.id,
      slug: workspace.slug,
      name: workspace.name,
      config: workspace.config,
    };
  } catch {
    // DB unreachable (e.g. pooler saturation): fall back to the default so the
    // app renders its designed empty state instead of a 500 on every route.
    return DEFAULT_WORKSPACE;
  }
}

/**
 * Persist the active-workspace choice. Cookie WRITES only work from a Server
 * Function or Route Handler, never during a Server Component's render (Next's
 * documented restriction — see the cookies.md doc cited above). Mirrors
 * `src/lib/supabase/server.ts`'s `setAll`: caught and ignored when called from
 * a context that can't set cookies, so a stray call from a Server Component
 * degrades quietly instead of crashing the render; the next Server Action /
 * Route Handler call is the one that actually persists it.
 */
export async function setActiveWorkspace(slug: string): Promise<void> {
  try {
    const store = await cookies();
    store.set(ACTIVE_WORKSPACE_COOKIE, slug, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 365, // 1 year
    });
  } catch {
    // Called from a Server Component that can't set cookies — safe to
    // ignore, see the doc comment above.
  }
}

export async function clearActiveWorkspace(): Promise<void> {
  try {
    const store = await cookies();
    store.delete(ACTIVE_WORKSPACE_COOKIE);
  } catch {
    // See setActiveWorkspace.
  }
}
