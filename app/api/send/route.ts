import { NextResponse, type NextRequest } from "next/server";
import { guardMutation } from "@/src/lib/auth-guard";
import { getDb } from "@/db/client";
import { readEncryptionKey, readOAuthDeps } from "@/src/crm/config";
import { readHubSpotSendConfig } from "@/src/send/config";
import { sendBriefEmail } from "@/src/send/send-brief";

// node:crypto (token decryption for the access-token provider) — pin Node.
export const runtime = "nodejs";

/**
 * Email SEND (R10, U11) — the "Send" button on a brief. Enrolls the practice's
 * contact into a live HubSpot Sequence so the AE's exact edited subject + body
 * ships through the rep's connected inbox. Session-gated (R18).
 *
 * SECURITY / D9: the recipient address is resolved SERVER-SIDE from the practice's
 * own contact row — the body carries only the practice id + the edited copy, never
 * an address or a portal id. The D9 firewall runs before any HubSpot call, so a
 * send can only ever reach the registered sandbox address.
 */

interface SendBody {
  practiceId: string;
  subject: string;
  body: string;
  cta?: string | null;
}

function parseBody(input: unknown): SendBody | null {
  if (typeof input !== "object" || input === null) return null;
  const b = input as Record<string, unknown>;
  if (
    typeof b.practiceId !== "string" ||
    b.practiceId.length === 0 ||
    typeof b.subject !== "string" ||
    b.subject.length === 0 ||
    typeof b.body !== "string" ||
    b.body.length === 0
  ) {
    return null;
  }
  const cta = typeof b.cta === "string" ? b.cta : null;
  return { practiceId: b.practiceId, subject: b.subject, body: b.body, cta };
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
    return NextResponse.json({ error: "Invalid send payload" }, { status: 400 });
  }

  let encryptionKey: Buffer;
  let deps;
  let sendConfig;
  try {
    encryptionKey = readEncryptionKey();
    deps = readOAuthDeps();
    sendConfig = readHubSpotSendConfig();
  } catch {
    return NextResponse.json({ error: "Send is not configured" }, { status: 503 });
  }

  try {
    const outcome = await sendBriefEmail(getDb(), deps, {
      practiceId: body.practiceId,
      subject: body.subject,
      body: body.body,
      cta: body.cta,
      encryptionKey,
      sendConfig,
    });
    if (!outcome.ok) {
      return NextResponse.json({ error: outcome.error }, { status: outcome.status });
    }
    return NextResponse.json({
      ok: true,
      contactId: outcome.contactId,
      touchNumber: outcome.touchNumber,
      enrolled: outcome.enrolled,
    });
  } catch {
    // Never echo the underlying error — HubSpot validation bodies can quote contact
    // data (D9). The generic message is what the AE sees; details stay server-side.
    return NextResponse.json({ error: "Send failed" }, { status: 502 });
  }
}
