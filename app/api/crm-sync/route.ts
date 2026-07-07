import { NextResponse } from "next/server";
import { guardMutation } from "@/src/lib/auth-guard";

// CRM push/sync trigger (R8). Session-gated (R18); HubSpot adapter lands in U10.
export async function POST() {
  const auth = await guardMutation();
  if (!auth.ok) return NextResponse.json(auth.body, { status: auth.status });
  return NextResponse.json({
    ok: true,
    note: "crm-sync route stub — HubSpot adapter lands in U10",
  });
}
