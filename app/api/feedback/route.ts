import { NextResponse } from "next/server";
import { z } from "zod";
import { guardMutation } from "@/src/lib/auth-guard";
import { getDb } from "@/db/client";
import { recordFeedback } from "@/db/feedback";

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
    // A dangling practiceId (FK) or DB error: log and report it, never swallow.
    console.error("feedback.persist_failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "Could not save feedback" }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
