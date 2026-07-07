import path from "node:path";
import { defineConfig } from "vitest/config";

const root = path.resolve(__dirname, ".");

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
  resolve: {
    // Mirror the tsconfig `@/*` -> repo-root alias. Regex avoids matching
    // scoped packages like `@electric-sql/*`.
    alias: [{ find: /^@\/(.*)$/, replacement: `${root}/$1` }],
  },
});
