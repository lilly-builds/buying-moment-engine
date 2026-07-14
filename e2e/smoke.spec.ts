import { expect, test } from "@playwright/test";

/**
 * Public-surface smoke (COV-01). Deterministic, no auth: proves the app boots and
 * renders, the auth gate fails closed, and the hardening from COV-13/COV-06 is live.
 */

test.describe("public surface", () => {
  test("login page renders the sign-in form", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByLabel(/work email/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /send sign-in link/i })).toBeVisible();
  });

  test("an unauthenticated protected route fails closed to /login", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/login/);
  });

  test("security headers are present on a response (COV-13, live)", async ({ request }) => {
    const res = await request.get("/login");
    const headers = res.headers();
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["strict-transport-security"]).toContain("includeSubDomains");
    expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
  });

  test("the health probe is public and returns a status (COV-06, live)", async ({ request }) => {
    const res = await request.get("/api/health");
    const body = await res.json();
    expect(["ok", "degraded"]).toContain(body.status);
    expect(body.checks).toHaveProperty("database");
  });
});
