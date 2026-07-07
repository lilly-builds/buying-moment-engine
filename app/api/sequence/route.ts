import { NextResponse } from "next/server";
import { guardMutation } from "@/src/lib/auth-guard";

// Inline 3-touch sequence edits, saved as drafts (R7). Session-gated (R18);
// persistence lands in U9.
export async function POST() {
  const auth = await guardMutation();
  if (!auth.ok) return NextResponse.json(auth.body, { status: auth.status });
  return NextResponse.json({
    ok: true,
    note: "sequence route stub — persistence lands in U9",
  });
}
