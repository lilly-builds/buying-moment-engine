import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/db/client";
import { recordMarketingEvent, sessionAlreadyViewed } from "@/db/marketing";

/**
 * Public, unauthenticated page-view beacon for the landing experiments. The
 * landing pages POST one of these on load so conversion RATE (signups / views)
 * per variant is a real number. PII-free by construction: it stores an opaque
 * client session id (for de-duplication) and never an email.
 *
 * De-duplicates to one 'view' per session per variant so a refresh or a bot loop
 * doesn't inflate the denominator. Fails soft — analytics must never break a page.
 */
export const runtime = "nodejs";

const VARIANTS = new Set(["saas", "outbound", "founders"]);
const MAX = 120;

function str(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (t.length === 0 || t.length > max) return null;
  return t;
}

export async function POST(request: NextRequest) {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  if (typeof raw !== "object" || raw === null) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const b = raw as Record<string, unknown>;

  const variant = typeof b.variant === "string" ? b.variant.trim().toLowerCase() : "";
  if (!VARIANTS.has(variant)) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const sessionId = str(b.sessionId, 80);

  try {
    const db = getDb();
    if (sessionId && (await sessionAlreadyViewed(db, variant, sessionId))) {
      return NextResponse.json({ ok: true, deduped: true });
    }
    await recordMarketingEvent(db, {
      eventType: "view",
      variant,
      path: str(b.path, 200),
      sessionId,
      utmSource: str(b.utmSource, MAX),
      utmMedium: str(b.utmMedium, MAX),
      utmCampaign: str(b.utmCampaign, MAX),
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[track] event failed:", err instanceof Error ? err.message : err);
    // Fail soft: a tracking hiccup must never surface to the visitor.
    return NextResponse.json({ ok: false }, { status: 200 });
  }
}
