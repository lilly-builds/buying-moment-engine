import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "@/db/schema";
import type { Database } from "@/db/types";

/**
 * PGlite test-DB factory. In-process WASM Postgres (no Docker, real SQL
 * semantics). Each suite spins a fresh instance and applies the generated
 * Drizzle migrations, so data-layer/integration tests run against real Postgres.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(here, "../db/migrations");

export interface TestDb {
  db: Database;
  close: () => Promise<void>;
}

export async function createTestDb(): Promise<TestDb> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  return {
    db,
    close: () => client.close(),
  };
}
