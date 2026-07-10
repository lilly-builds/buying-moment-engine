import { NextResponse, type NextRequest } from "next/server";
import { guardMutation } from "@/src/lib/auth-guard";
import { getDb } from "@/db/client";
import { readEncryptionKey, readOAuthDeps } from "@/src/crm/config";
import { readHubSpotSendConfig } from "@/src/send/config";
import { sendBriefEmail } from "@/src/send/send-brief";

// node:crypto (token decryption for the access-token provider) — pin Node.
export const runtime = "nodejs";

/**
 * Email SEND (R10, U11) — the "Launch outreach" action on a brief. Enrolls the
 * practice's contact ONCE into a live HubSpot Sequence and ships EVERY edited touch's
 * copy (each into its own property pair) so the Sequence's step-N email renders touch
 * N's own subject + body through the rep's connected inbox. Session-gated (R18).
 *
 * SECURITY / D9: the recipient address is resolved SERVER-SIDE from the practice's
 * own contact row — the body carries only the practice id + the edited touches, never
 * an address or a portal id. The D9 firewall runs before any HubSpot call, so a
 * send can only ever reach the registered sandbox address.
 */

interface SendTouchBody {
  touchNumber: number;
  subject: string;
  body: string;
}

interface SendBody {
  practiceId: string;
  touches: SendTouchBody[];
  cta: string | null;
}

/** One touch is valid iff it has a 1..3 touchNumber and non-empty subject + body. */
function parseTouch(input: unknown): SendTouchBody | null {
  if (typeof input !== "object" || input === null) return null;
  const t = input as Record<string, unknown>;
  if (
    typeof t.touchNumber !== "number" ||
    !Number.isInteger(t.touchNumber) ||
    t.touchNumber < 1 ||
    t.touchNumber > 3 ||
    typeof t.subject !== "string" ||
    t.subject.length === 0 ||
    typeof t.body !== "string" ||
    t.body.length === 0
  ) {
    return null;
  }
  return { touchNumber: t.touchNumber, subject: t.subject, body: t.body };
}

function parseBody(input: unknown): SendBody | null {
  if (typeof input !== "object" || input === null) return null;
  const b = input as Record<string, unknown>;
  if (typeof b.practiceId !== "string" || b.practiceId.length === 0) return null;
  if (!Array.isArray(b.touches) || b.touches.length === 0 || b.touches.length > 3) {
    return null;
  }
  const touches: SendTouchBody[] = [];
  const seen = new Set<number>();
  for (const raw of b.touches) {
    const touch = parseTouch(raw);
    // Reject a malformed touch OR a duplicate position (two touches can't map to
    // one property pair / Sequence step).
    if (!touch || seen.has(touch.touchNumber)) return null;
    seen.add(touch.touchNumber);
    touches.push(touch);
  }
  const cta = typeof b.cta === "string" ? b.cta : null;
  return { practiceId: b.practiceId, touches, cta };
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
      touches: body.touches,
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
      touchesSent: outcome.touchesSent,
      enrolled: outcome.enrolled,
    });
  } catch {
    // Never echo the underlying error — HubSpot validation bodies can quote contact
    // data (D9). The generic message is what the AE sees; details stay server-side.
    return NextResponse.json({ error: "Send failed" }, { status: 502 });
  }
}
