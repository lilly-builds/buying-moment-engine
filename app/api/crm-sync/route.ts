import { NextResponse, type NextRequest } from "next/server";
import { guardMutation } from "@/src/lib/auth-guard";
import { getDb } from "@/db/client";
import { readEncryptionKey, readOAuthDeps } from "@/src/crm/config";
import { createHubSpotAdapter } from "@/src/crm/hubspot";
import { createDbTokenProvider, pushPracticeLead } from "@/src/crm/sync";
import type { LeadInput } from "@/src/crm/adapter";

// node:crypto (token decryption for the access-token provider) — pin Node.
export const runtime = "nodejs";

/**
 * CRM push (R8, U10) — lands a tool-sourced lead in HubSpot as company + contact
 * + deal with all four tags, idempotently (keyed off the stored `crm_links` id).
 * Session-gated (R18). The assembled lead + the target portal come in the body;
 * the access token is fetched (and proactively refreshed) per-tenant.
 */

interface SyncBody {
  practiceId: string;
  portalId: string;
  lead: LeadInput;
}

function parseBody(input: unknown): SyncBody | null {
  if (typeof input !== "object" || input === null) return null;
  const b = input as Record<string, unknown>;
  const lead = b.lead as Record<string, unknown> | undefined;
  const tags = lead?.tags as Record<string, unknown> | undefined;
  if (
    typeof b.practiceId !== "string" ||
    typeof b.portalId !== "string" ||
    !lead ||
    typeof lead.companyName !== "string" ||
    !tags ||
    typeof tags.vertical !== "string" ||
    typeof tags.signalSource !== "string" ||
    typeof tags.signalCount !== "number"
  ) {
    return null;
  }
  return { practiceId: b.practiceId, portalId: b.portalId, lead: lead as unknown as LeadInput };
}

export async function POST(request: NextRequest) {
  const auth = await guardMutation();
  if (!auth.ok) return NextResponse.json(auth.body, { status: auth.status });

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const body = parseBody(raw);
  if (!body) {
    return NextResponse.json({ error: "Invalid sync payload" }, { status: 400 });
  }

  let encryptionKey: Buffer;
  let deps;
  try {
    encryptionKey = readEncryptionKey();
    deps = readOAuthDeps();
  } catch {
    return NextResponse.json({ error: "CRM not configured" }, { status: 503 });
  }

  try {
    const db = getDb();
    const getAccessToken = createDbTokenProvider(db, deps, {
      portalId: body.portalId,
      encryptionKey,
    });
    const adapter = createHubSpotAdapter({ fetch, getAccessToken });
    const result = await pushPracticeLead(db, adapter, {
      practiceId: body.practiceId,
      lead: body.lead,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch {
    return NextResponse.json({ error: "CRM sync failed" }, { status: 502 });
  }
}
