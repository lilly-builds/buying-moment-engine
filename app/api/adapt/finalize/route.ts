import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/db/client";
import { anthropicAdaptClient } from "@/src/adapt/client";
import { buildFallbackSampleFeed, slugify } from "@/src/adapt/fallback";
import { finalizeWorkspace } from "@/src/adapt/finalize";
import {
  DraftWorkspaceConfigSchema,
  type DraftWorkspaceConfig,
} from "@/src/adapt/schema";
import { createWorkspace } from "@/src/workspace/store";
import { setActiveWorkspace } from "@/src/workspace/active";
import { resolveProviderKey } from "@/src/keys/provider-keys";

// Streams from Anthropic, writes to Postgres, and sets a cookie — Node runtime.
export const runtime = "nodejs";

/**
 * POST /api/adapt/finalize — the Adapter's reveal step (Phase 3).
 *
 * Body: `{ config }` — the possibly-user-edited DRAFT config (no sample feed).
 * Generates the sample feed, assembles the full workspace, persists it, sets it
 * active (cookie), and returns `{ slug }`. The dashboard then renders the tenant
 * brand + feed for that active workspace.
 *
 * The Claude feed call always falls back deterministically. If no Anthropic key
 * is available we skip the model entirely and persist with the fallback feed, so
 * the flow still completes. Only a bad draft (422) or a DB failure (503) can stop
 * it — honest infrastructure errors, never a silent half-finish.
 */

function parseDraft(input: unknown): DraftWorkspaceConfig | null {
  if (typeof input !== "object" || input === null) return null;
  const b = input as Record<string, unknown>;
  const result = DraftWorkspaceConfigSchema.safeParse(b.config);
  return result.success ? result.data : null;
}

async function resolveAnthropicKey(): Promise<string | null> {
  try {
    return await resolveProviderKey(getDb(), "anthropic");
  } catch {
    return process.env.ANTHROPIC_API_KEY ?? null;
  }
}

export async function POST(request: NextRequest) {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const draft = parseDraft(raw);
  if (!draft) {
    return NextResponse.json(
      { error: "That configuration is incomplete. Go back a step and try again." },
      { status: 422 },
    );
  }

  const key = await resolveAnthropicKey();

  try {
    if (key) {
      const result = await finalizeWorkspace(draft, {
        client: anthropicAdaptClient(key),
      });
      return NextResponse.json(result);
    }

    // No key: persist with the deterministic sample feed rather than dead-end.
    const sampleFeed = buildFallbackSampleFeed(draft);
    const workspace = await createWorkspace({
      name: draft.brand.companyName,
      slug: slugify(draft.brand.companyName || draft.brand.productName),
      config: { ...draft, sampleFeed },
    });
    await setActiveWorkspace(workspace.slug);
    return NextResponse.json({ slug: workspace.slug });
  } catch {
    // DATABASE_URL missing or DB unreachable -> honest failure, never a fake done.
    return NextResponse.json(
      { error: "We could not save your workspace. Please try again in a moment." },
      { status: 503 },
    );
  }
}
