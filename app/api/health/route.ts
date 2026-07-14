import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { buildHealthReport, healthStatusCode } from "@/src/lib/health";

// Unauthenticated liveness/readiness probe (COV-06) for synthetic monitoring.
// Returns only up/down, never any row data. 503 = app up but data layer unreachable.
export const dynamic = "force-dynamic";

export async function GET() {
  const report = await buildHealthReport(async () => {
    await getDb().execute(sql`select 1`);
    return true;
  });
  return NextResponse.json(report, { status: healthStatusCode(report) });
}
