/**
 * Health-check logic (COV-06). Kept pure and injectable so `app/api/health/route.ts`
 * is a thin adapter that supplies a real database ping. A synthetic monitor hits the
 * route; a 503 means the app is up but cannot reach its data layer.
 */

export type HealthStatus = "ok" | "degraded";

export interface HealthReport {
  status: HealthStatus;
  checks: { database: "up" | "down" };
}

/** Runs the DB ping (swallowing its error so no internals leak) and grades the result. */
export async function buildHealthReport(
  pingDatabase: () => Promise<boolean>,
): Promise<HealthReport> {
  let databaseUp = false;
  try {
    databaseUp = await pingDatabase();
  } catch {
    databaseUp = false;
  }
  return {
    status: databaseUp ? "ok" : "degraded",
    checks: { database: databaseUp ? "up" : "down" },
  };
}

export function healthStatusCode(report: HealthReport): number {
  return report.status === "ok" ? 200 : 503;
}
