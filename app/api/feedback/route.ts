import { NextResponse } from "next/server";
import { guardMutation } from "@/src/lib/auth-guard";

// AE lead-quality feedback (R13). Session-gated (R18); persistence lands in U9.
export async function POST() {
  const auth = await guardMutation();
  if (!auth.ok) return NextResponse.json(auth.body, { status: auth.status });
  return NextResponse.json({
    ok: true,
    note: "feedback route stub — persistence lands in U9",
  });
}
