import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";
import type { Database } from "./types";

/**
 * Lazy singleton Drizzle client (postgres-js). Reading DATABASE_URL is deferred
 * to first use so `next build` and a keyless deploy succeed with no DB present —
 * callers that can't reach a DB fall back to a designed empty state.
 */
let cached: Database | null = null;

export function getDb(): Database {
  if (cached) return cached;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const client = postgres(url, { prepare: false });
  cached = drizzle(client, { schema });
  return cached;
}
