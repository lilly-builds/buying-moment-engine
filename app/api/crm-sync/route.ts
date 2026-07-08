import { NextResponse, type NextRequest } from "next/server";
import { guardMutation } from "@/src/lib/auth-guard";
import { getDb } from "@/db/client";
import { readEncryptionKey, readOAuthDeps } from "@/src/crm/config";
import { syncPracticeLead } from "@/src/crm/sync";
import type { LeadInput } from "@/src/crm/adapter";

// node:crypto (token decryption for the access-token provider) — pin Node.
export const runtime = "nodejs";

/**
 * CRM push (R8, U10) — lands a tool-sourced lead in HubSpot as company + contact
 * + deal with all four tags, idempotently. Session-gated (R18).
 *
 * SECURITY (U10 hardening): the target HubSpot connection is resolved
 * SERVER-SIDE from stored connections — the request body carries only the lead
 * to push, NEVER a portal id. A caller cannot point the push at another tenant's
 * tokens (no IDOR).
 */

interface SyncBody {
  practiceId: string;
  lead: LeadInput;
}

function parseBody(input: unknown): SyncBody | null {
  if (typeof input !== "object" || input === null) return null;
  const b = input as Record<string, unknown>;
  const lead = b.lead as Record<string, unknown> | undefined;
  const tags = lead?.tags as Record<string, unknown> | undefined;
  if (
    typeof b.practiceId !== "string" ||
    !lead ||
    typeof lead.companyName !== "string" ||
    !tags ||
    typeof tags.vertical !== "string" ||
    typeof tags.signalSource !== "string" ||
    typeof tags.signalCount !== "number"
  ) {
    return null;
  }
  // Any `portalId` in the body is deliberately IGNORED — the connection is
  // resolved server-side. This is the IDOR fix; never read a portal from input.
  return { practiceId: b.practiceId, lead: lead as unknown as LeadInput };
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
    const outcome = await syncPracticeLead(getDb(), deps, {
      practiceId: body.practiceId,
      lead: body.lead,
      encryptionKey,
    });
    if (!outcome.ok) {
      return NextResponse.json({ error: outcome.error }, { status: outcome.status });
    }
    return NextResponse.json({ ok: true, ...outcome.result });
  } catch {
    return NextResponse.json({ error: "CRM sync failed" }, { status: 502 });
  }
}
