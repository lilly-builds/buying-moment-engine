import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright smoke suite (COV-01). Covers the public surface of the real app: the app
 * boots, the login page renders, protected routes fail closed to /login, and the live
 * security headers (COV-13) and health probe (COV-06) are wired. Authed-page coverage
 * (feed/brief render) needs the Supabase service-role secret and is intentionally not
 * wired here; see the finding.
 *
 * Runs against `next dev` on a non-default port (the handoff notes `-p` is mis-parsed by
 * this Next, so PORT= is used). Not yet a required CI gate: booting the app in CI needs
 * env secrets (DATABASE_URL, Supabase keys), which is a separate secrets decision.
 */

const PORT = Number(process.env.E2E_PORT ?? 3123);
const baseURL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `PORT=${PORT} pnpm dev`,
    url: `${baseURL}/login`,
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
  },
});
