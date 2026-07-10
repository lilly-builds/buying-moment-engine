import { NextResponse, type NextRequest } from "next/server";
import { guardMutation } from "@/src/lib/auth-guard";
import { getDb } from "@/db/client";
import { getActiveConnection, setConnectionSendConfig } from "@/db/crm";

// node:pg via Drizzle — pin Node.
export const runtime = "nodejs";

/**
 * Per-connection SEND config capture (per-connection-send-config). The user pastes
 * their HubSpot sequence id — the number after `/sequence/` in the URL — after they
 * finish sequence setup (HubSpot has no create/list-sequence API, so this one value
 * cannot be auto-discovered; the sender inbox + user id auto-capture at connect).
 * It's written onto THEIR active connection so the send path uses their own sequence.
 *
 * SECURITY: the target connection is resolved SERVER-SIDE (never a portal id from
 * the body — IDOR). Session-gated (R18). The id is validated numeric before write.
 */

/** HubSpot sequence ids are numeric; guard against a pasted full URL or junk. */
function parseSequenceId(input: unknown): string | null {
  if (typeof input !== "object" || input === null) return null;
  const raw = (input as Record<string, unknown>).sequenceId;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  // Digits only, 1–18 chars (HubSpot ids are well under this) — rejects a pasted
  // `.../sequence/712515259/steps`, letting the UI tell the user to paste the number.
  return /^\d{1,18}$/.test(trimmed) ? trimmed : null;
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
  const sequenceId = parseSequenceId(raw);
  if (!sequenceId) {
    return NextResponse.json(
      { error: "Enter your sequence ID — the number in the URL after /sequence/." },
      { status: 400 },
    );
  }

  const db = getDb();
  const active = await getActiveConnection(db);
  if (!active.ok) {
    return active.reason === "none"
      ? NextResponse.json(
          { error: "Connect HubSpot first, then save your sequence ID." },
          { status: 409 },
        )
      : NextResponse.json(
          { error: "Multiple HubSpot connections — cannot resolve one." },
          { status: 409 },
        );
  }

  // Server-resolved portal — never client-supplied (IDOR).
  const { updated } = await setConnectionSendConfig(db, {
    portalId: active.connection.portalId,
    sequenceId,
  });
  if (!updated) {
    // The connection vanished between resolve and write — surface, don't assert.
    return NextResponse.json(
      { error: "Couldn't save — reconnect HubSpot and try again." },
      { status: 409 },
    );
  }

  return NextResponse.json({ ok: true, sequenceId });
}
