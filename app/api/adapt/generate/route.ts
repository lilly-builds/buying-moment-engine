import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/db/client";
import { anthropicAdaptClient } from "@/src/adapt/client";
import { buildFallbackDraft } from "@/src/adapt/fallback";
import { generateDraftConfig } from "@/src/adapt/generate";
import type { GenerateInput } from "@/src/adapt/schema";
import { resolveProviderKey } from "@/src/keys/provider-keys";

// Streams from Anthropic + reads BYOK/env keys — pin the Node runtime.
export const runtime = "nodejs";

/**
 * POST /api/adapt/generate — the Adapter's first pass (Phase 3).
 *
 * Body: `{ companyName, whatYouSell, websiteUrl? }`.
 * Returns: `{ config, source: "ai" | "fallback" }` where `config` is a validated
 * DRAFT workspace config (no sample feed).
 *
 * This is a PRE-SIGNUP flow (a brand-new business adapting the engine to itself),
 * so it is intentionally NOT session-gated — the entry point is the login screen.
 * It never errors to the client: with no key, a bad key, or any model failure,
 * the deterministic fallback stands.
 */

const MAX_FIELD = 4000;

function parseBody(input: unknown): GenerateInput | null {
  if (typeof input !== "object" || input === null) return null;
  const b = input as Record<string, unknown>;
  if (typeof b.companyName !== "string" || typeof b.whatYouSell !== "string") {
    return null;
  }
  const companyName = b.companyName.trim();
  const whatYouSell = b.whatYouSell.trim();
  if (companyName.length === 0 || whatYouSell.length === 0) return null;
  if (companyName.length > MAX_FIELD || whatYouSell.length > MAX_FIELD) return null;
  const websiteUrl =
    typeof b.websiteUrl === "string" && b.websiteUrl.trim().length > 0
      ? b.websiteUrl.trim().slice(0, MAX_FIELD)
      : null;
  return { companyName, whatYouSell, websiteUrl };
}

/**
 * The Anthropic key: the stored BYOK key first, else the env key (the "full value
 * before a single key" contract). Wrapped so a missing DATABASE_URL degrades to
 * the env key rather than throwing before generation.
 */
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

  const input = parseBody(raw);
  if (!input) {
    return NextResponse.json(
      { error: "Tell us your company name and what you sell." },
      { status: 400 },
    );
  }

  const key = await resolveAnthropicKey();
  if (!key) {
    // No key at all: still return a usable, on-inputs config. Never a dead end.
    return NextResponse.json({ config: buildFallbackDraft(input), source: "fallback" });
  }

  const result = await generateDraftConfig(input, anthropicAdaptClient(key));
  return NextResponse.json(result);
}
