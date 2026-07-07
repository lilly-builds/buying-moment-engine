import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type * as schema from "./schema";

/**
 * Driver-agnostic Drizzle database type. Both the production postgres-js client
 * and the PGlite test client are subtypes, so data-layer helpers accept either
 * — logic tests run against real Postgres semantics (PGlite) with no mocks.
 */
export type Database = PgDatabase<PgQueryResultHKT, typeof schema>;
