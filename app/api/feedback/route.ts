import { NextResponse } from "next/server";
import { z } from "zod";
import { guardMutation } from "@/src/lib/auth-guard";
import { getDb } from "@/db/client";
import { recordFeedback } from "@/db/feedback";

/** Dig a Postgres SQLSTATE code out of an error (or its cause chain). */
function pgErrorCode(err: unknown): string | null {
  let cur: unknown = err;
  for (let depth = 0; cur && depth < 5; depth++) {
    if (typeof cur === "object" && cur !== null && "code" in cur) {
      const code = (cur as { code: unknown }).code;
      if (typeof code === "string" && /^\d{5}$/.test(code)) return code;
    }
    cur = typeof cur === "object" && cur !== null ? (cur as { cause?: unknown }).cause : null;
  }
  return null;
}

// AE lead-quality feedback (R13). Session-gated (R18); persists the vote (COV-11).
const bodySchema = z.object({
  practiceId: z.uuid(),
  thumb: z.enum(["up", "down"]),
  reason: z.enum(["too_small", "wrong_specialty", "already_customer", "bad_timing"]).nullish(),
  freeText: z.string().max(2000).nullish(),
});

export async function POST(request: Request) {
  const auth = await guardMutation();
  if (!auth.ok) return NextResponse.json(auth.body, { status: auth.status });

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid feedback payload" }, { status: 400 });
  }

  try {
    await recordFeedback(getDb(), { ...parsed.data, aeEmail: auth.email });
  } catch (err) {
    // Never swallow: log and report. Distinguish a client-caused constraint failure
    // (bad practiceId) from a genuine server/DB fault, so a real outage returns 5xx and
    // trips server-error alerting instead of masquerading as a bad request.
    const code = pgErrorCode(err);
    console.error("feedback.persist_failed", {
      error: err instanceof Error ? err.message : String(err),
      code,
    });
    if (code === "23503") {
      return NextResponse.json({ error: "Unknown practice" }, { status: 400 });
    }
    if (code === "23505") {
      return NextResponse.json({ error: "Conflicting vote" }, { status: 409 });
    }
    return NextResponse.json({ error: "Could not save feedback" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
