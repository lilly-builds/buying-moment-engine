/**
 * Schema barrel — the single import surface for the Drizzle schema.
 * Domains: ingest (raw) -> entities (normalized) -> brief -> crm -> roi.
 */
export * from "./ingest";
export * from "./entities";
export * from "./brief";
export * from "./crm";
export * from "./roi";
