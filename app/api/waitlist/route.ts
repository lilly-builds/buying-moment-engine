import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/db/client";
import { recordMarketingEvent, recordWaitlistSignup } from "@/db/marketing";

/**
 * Public waitlist / "get my 3 free briefs" capture for the landing experiments.
 *
 * This is one of only two PUBLIC, unauthenticated write routes in the app (the
 * other is /api/track). A cold visitor has no session, so guardMutation() does
 * NOT apply here. Because it is public, it validates hard: email shape + length
 * caps, an allowlisted `variant`, a honeypot field, and it only ever writes the
 * two RLS-locked marketing tables (never product data). Writes go through the
 * server's owner connection, so the anon client can never touch these rows.
 *
 * On success it records BOTH a durable lead (waitlist_signups) and a funnel
 * event (marketing_events, event_type='signup'), so the A/B readout is exact.
 */
export const runtime = "nodejs";

const VARIANTS = new Set(["saas", "outbound", "founders"]);
const MAX_EMAIL = 254;
const MAX_SELL = 280;
const MAX_UTM = 120;

// Deliberately permissive but real: one @, a dot in the domain, no spaces.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface Parsed {
  email: string;
  variant: string;
  whatYouSell: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  referrer: string | null;
}

function str(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (t.length === 0 || t.length > max) return null;
  return t;
}

function parseBody(input: unknown): { ok: true; value: Parsed } | { ok: false; error: string } {
  if (typeof input !== "object" || input === null) {
    return { ok: false, error: "Invalid request." };
  }
  const b = input as Record<string, unknown>;

  // Honeypot: a hidden field real users never fill. If present, silently drop.
  if (typeof b.company_website === "string" && b.company_website.trim().length > 0) {
    return { ok: false, error: "spam" };
  }

  const emailRaw = typeof b.email === "string" ? b.email.trim().toLowerCase() : "";
  if (emailRaw.length === 0 || emailRaw.length > MAX_EMAIL || !EMAIL_RE.test(emailRaw)) {
    return { ok: false, error: "Enter a valid work email." };
  }

  const variant = typeof b.variant === "string" ? b.variant.trim().toLowerCase() : "";
  if (!VARIANTS.has(variant)) {
    return { ok: false, error: "Unknown page." };
  }

  return {
    ok: true,
    value: {
      email: emailRaw,
      variant,
      whatYouSell: str(b.whatYouSell, MAX_SELL),
      utmSource: str(b.utmSource, MAX_UTM),
      utmMedium: str(b.utmMedium, MAX_UTM),
      utmCampaign: str(b.utmCampaign, MAX_UTM),
      referrer: str(b.referrer, 500),
    },
  };
}

export async function POST(request: NextRequest) {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = parseBody(raw);
  if (!parsed.ok) {
    // Honeypot hits get a fake-success so bots don't learn the filter.
    if (parsed.error === "spam") return NextResponse.json({ ok: true });
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const v = parsed.value;
  try {
    const db = getDb();
    const { id, isNew } = await recordWaitlistSignup(db, v);
    // Only count a conversion the first time this email+variant signs up, so a
    // repeat submit does not inflate the funnel. Best-effort: never fail the
    // signup if the event write hiccups.
    if (isNew) {
      try {
        await recordMarketingEvent(db, {
          eventType: "signup",
          variant: v.variant,
          path: `/for/${v.variant}`,
          utmSource: v.utmSource,
          utmMedium: v.utmMedium,
          utmCampaign: v.utmCampaign,
        });
      } catch {
        // swallow: the lead is already saved, the event is analytics-only
      }
    }
    return NextResponse.json({ ok: true, id });
  } catch (err) {
    console.error("[waitlist] insert failed:", err instanceof Error ? err.message : err);
    return NextResponse.json(
      { error: "Something went wrong saving that. Try again in a moment." },
      { status: 500 },
    );
  }
}
