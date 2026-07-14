import { describe, expect, it } from "vitest";
import { buildHealthReport, healthStatusCode } from "@/src/lib/health";

/**
 * Health endpoint logic (COV-06). A synthetic monitor needs one unauthenticated URL
 * that says whether the app can reach its database. Pure and injectable so the route
 * stays a thin adapter.
 */

describe("buildHealthReport", () => {
  it("reports ok / up / 200 when the database ping succeeds", async () => {
    const report = await buildHealthReport(async () => true);
    expect(report.status).toBe("ok");
    expect(report.checks.database).toBe("up");
    expect(healthStatusCode(report)).toBe(200);
  });

  it("reports degraded / down / 503 when the ping returns false", async () => {
    const report = await buildHealthReport(async () => false);
    expect(report.status).toBe("degraded");
    expect(report.checks.database).toBe("down");
    expect(healthStatusCode(report)).toBe(503);
  });

  it("reports degraded / down / 503 when the ping throws (never leaks the error)", async () => {
    const report = await buildHealthReport(async () => {
      throw new Error("connection refused");
    });
    expect(report.status).toBe("degraded");
    expect(report.checks.database).toBe("down");
    expect(healthStatusCode(report)).toBe(503);
  });
});
