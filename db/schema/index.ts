/**
 * Schema barrel — the single import surface for the Drizzle schema.
 * Domains: ingest (raw) -> entities (normalized) -> brief -> crm -> roi.
 *
 * RLS: Row-Level Security is ENABLED on all tables with NO public policies
 * (deny-by-default). All data access is server-mediated by the authenticated
 * Next.js server over the direct Postgres connection (DATABASE_URL, as the table
 * owner, which bypasses RLS); the Supabase anon key is auth-only and never runs
 * table queries. This locks the auto-generated PostgREST/GraphQL API to zero
 * public surface. Later UI units MUST read through server routes/RSC, never the
 * anon client.
 */
export * from "./ingest";
export * from "./entities";
export * from "./brief";
export * from "./crm";
export * from "./roi";
