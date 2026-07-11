import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";
import type { Database } from "./types";

/**
 * Lazy singleton Drizzle client (postgres-js). Reading DATABASE_URL is deferred
 * to first use so `next build` and a keyless deploy succeed with no DB present —
 * callers that can't reach a DB fall back to a designed empty state.
 *
 * The singleton is cached on `globalThis`, not a module-scoped `let`: Next.js dev
 * (HMR) re-evaluates modules on hot reload, which would otherwise open a brand-new
 * postgres pool on every reload without closing the old one and quickly exhaust the
 * Supabase session pooler (EMAXCONNSESSION). A globalThis cache survives HMR, and a
 * small `max` keeps a single instance well under the pooler's client cap.
 */
const globalForDb = globalThis as unknown as { __bmeDb?: Database };

export function getDb(): Database {
  if (globalForDb.__bmeDb) return globalForDb.__bmeDb;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const client = postgres(url, { prepare: false, max: 5, idle_timeout: 20 });
  globalForDb.__bmeDb = drizzle(client, { schema });
  return globalForDb.__bmeDb;
}
