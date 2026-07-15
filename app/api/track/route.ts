import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/src/lib/supabase/server";
import { getDb } from "@/db/client";
import { recordActivity } from "@/db/activity";

/**
 * First-party page-view beacon. The client `ActivityTracker` POSTs `{ path }` on
 * each route change; we resolve WHO server-side from the session cookie so the
 * logged email can't be forged from the body.
 *
 * Node runtime (not Edge): `recordActivity` writes through postgres-js, which
 * needs a TCP socket the Edge runtime doesn't provide.
 *
 * Always answers 204 and never throws into the caller — a broken analytics write
 * must never surface to the visitor or break navigation. The `proxy.ts` gate
 * already turns away unauthenticated callers; re-checking the session here is the
 * fail-closed backstop, not an assumption that the gate ran.
 */
export const runtime = "nodejs";

const bodySchema = z.object({
  path: z.string().min(1).max(2048),
});

export async function POST(request: NextRequest): Promise<NextResponse> {
  let supabase;
  try {
    supabase = await createSupabaseServerClient();
  } catch {
    // Supabase env unconfigured — nothing to attribute the view to. No-op.
    return new NextResponse(null, { status: 204 });
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) return new NextResponse(null, { status: 204 });

  let path: string;
  try {
    path = bodySchema.parse(await request.json()).path;
  } catch {
    // Malformed beacon (bad JSON / missing path) — ignore rather than 400 a
    // fire-and-forget request the client never reads.
    return new NextResponse(null, { status: 204 });
  }

  try {
    await recordActivity(getDb(), {
      eventType: "page_view",
      email: user.email,
      path,
      userId: user.id,
      userAgent: request.headers.get("user-agent"),
    });
  } catch (err) {
    console.error("[activity] failed to record page_view:", err);
  }

  return new NextResponse(null, { status: 204 });
}
