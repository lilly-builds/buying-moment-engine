import path from "node:path";
import { defineConfig } from "vitest/config";

const root = path.resolve(__dirname, ".");

export default defineConfig({
  test: {
    environment: "node",
    // `.tsx` for component render tests (jsdom via a per-file `@vitest-environment` docblock).
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],

    /**
     * Every data-layer suite calls `createTestDb()` in `beforeEach` — that boots a fresh
     * WASM Postgres (PGlite) and applies all four migrations, per test.
     *
     * Vitest defaults to one worker per core and a 10s hook timeout. On an 8-core box
     * that is eight WASM Postgres instances booting at once, and `beforeEach` blows the
     * hook timeout: measured 26 and 33 failures across two consecutive full runs
     * (2026-07-08, U6), all `Hook timed out in 10000ms`, all in PGlite suites —
     * `db/ingest`, `db/migrations`, `db/queries`, `engine/resolver`, `crm/sync`.
     *
     * The suite was already at that edge before U6; adding 138 tests pushed it over, so
     * the earlier green runs were luck rather than a passing gate. Both knobs below are
     * needed: the timeout because migrating a WASM database genuinely takes seconds, and
     * the worker cap because the contention is what makes it take tens of them.
     *
     * These are numbers, not vibes: at `maxWorkers: 4` the full suite runs green
     * repeatably (see the U6 ship report). Raising the timeout alone would only make a
     * contended run slower before it failed.
     */
    hookTimeout: 30_000,
    testTimeout: 20_000,
    maxWorkers: 4,

    /**
     * Code-coverage gate (COV-02). Scoped to the business-logic layers that the
     * unit/integration suite is responsible for — `src`, `db`, `jobs`. UI render
     * coverage (`app/**`) is a different instrument (E2E/Playwright, COV-01) and is
     * deliberately not counted here, so this floor measures what these tests actually
     * own. `thresholds` make the runner exit non-zero below the floor (a ratchet, not
     * a stdout scrape). Raise the floor as coverage climbs; never lower it silently.
     */
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "json-summary"],
      // Setting `include` measures every matching file, tested or not (honest baseline).
      include: ["src/**/*.ts", "db/**/*.ts", "jobs/**/*.ts"],
      exclude: [
        "**/*.d.ts",
        "**/*.config.*",
        "db/migrations/**",
        "src/**/*.types.ts",
      ],
      // Floors set just under the 2026-07-13 measured baseline (lines 87.1 / statements
      // 85.0 / functions 86.6 / branches 77.0), leaving a small noise margin. Ratchet up.
      thresholds: {
        lines: 85,
        statements: 83,
        functions: 84,
        branches: 74,
      },
    },
  },
  resolve: {
    // Mirror the tsconfig `@/*` -> repo-root alias. Regex avoids matching
    // scoped packages like `@electric-sql/*`.
    alias: [{ find: /^@\/(.*)$/, replacement: `${root}/$1` }],
  },
});
