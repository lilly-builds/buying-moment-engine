import { NextResponse, type NextRequest } from "next/server";
import { getActiveWorkspace } from "@/src/workspace/active";
import { WorkspaceConfigSchema } from "@/src/workspace/schema";
import { updateWorkspaceConfig } from "@/src/workspace/store";

// Reads a cookie, validates, and writes to Postgres — Node runtime.
export const runtime = "nodejs";

/**
 * POST /api/workspace/update — save the active workspace's config (Adapt-It P4,
 * the Customization Studio's save action).
 *
 * Body: `{ config }` — the WHOLE `WorkspaceConfig` (brand, business, signals,
 * pitch, proof, and the untouched sampleFeed). The studio holds the full config in
 * state and posts all of it, because `updateWorkspaceConfig` replaces the config
 * wholesale — a partial post would drop the sample feed.
 *
 * The workspace being written is resolved SERVER-SIDE from the active-workspace
 * cookie, never taken from the body, so a client can only ever edit its own active
 * tenant (mirrors the send-config route's "portal resolved server-side" rule).
 *
 * Outcomes:
 *   - 400 — body isn't JSON.
 *   - 409 — the active workspace is the synthetic EliseAI default; the demo is
 *           read-only (the studio shows a read-only state, so this is a backstop).
 *   - 422 — the config fails `WorkspaceConfigSchema` (fail loud, never a silent
 *           half-write; the store would also reject it).
 *   - 503 — the DB is unreachable / the workspace row vanished.
 *   - 200 — `{ ok: true, slug }`. The studio then refreshes so the app re-skins.
 */
export async function POST(request: NextRequest) {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  let workspaceId: string;
  try {
    const workspace = await getActiveWorkspace();
    if (workspace.id === "default") {
      return NextResponse.json(
        {
          error:
            "The demo workspace can't be edited. Adapt the engine to your business first.",
        },
        { status: 409 },
      );
    }
    workspaceId = workspace.id;
  } catch {
    return NextResponse.json(
      { error: "We could not reach your workspace. Please try again in a moment." },
      { status: 503 },
    );
  }

  const body = (typeof raw === "object" && raw !== null ? raw : {}) as Record<
    string,
    unknown
  >;
  const parsed = WorkspaceConfigSchema.safeParse(body.config);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Some of your changes aren't valid yet. Check the highlighted fields." },
      { status: 422 },
    );
  }

  try {
    const updated = await updateWorkspaceConfig(workspaceId, parsed.data);
    if (!updated) {
      return NextResponse.json(
        { error: "That workspace no longer exists." },
        { status: 404 },
      );
    }
    return NextResponse.json({ ok: true, slug: updated.slug });
  } catch {
    return NextResponse.json(
      { error: "We could not save your changes. Please try again in a moment." },
      { status: 503 },
    );
  }
}
