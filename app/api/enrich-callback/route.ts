import { NextResponse, type NextRequest } from "next/server";
import { verifySharedSecret } from "@/src/lib/secret";

// Clay enrichment callback (R9). Shared-secret gated, NOT session gated — Clay
// posts enriched rows back here. The real enrichment upsert lands in U5.
export async function POST(request: NextRequest) {
  const provided = request.headers.get("x-clay-secret");
  if (!verifySharedSecret(provided, process.env.CLAY_CALLBACK_SECRET)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 401 });
  }
  return NextResponse.json({
    ok: true,
    note: "enrich-callback stub — enrichment lands in U5",
  });
}
