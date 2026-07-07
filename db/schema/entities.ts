import {
  integer,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, updatedAt } from "./columns";

/**
 * Entities domain — the normalized layer. Derived scores (signal count) are NOT
 * stored here; they compute in code from `signals` (R17: raw -> normalized ->
 * derived, every number traceable to its inputs).
 */

export const vertical = pgEnum("vertical", [
  "dermatology",
  "womens_health",
  "ophthalmology",
  "orthopedics",
  "unclassified",
]);

export const enrichmentStatus = pgEnum("enrichment_status", [
  "pending",
  "enriched",
  "failed",
]);

export const signalKind = pgEnum("signal_kind", [
  "staffing_spike",
  "phone_complaints",
  "growth_events",
  "regulation",
]);

export const practices = pgTable(
  "practices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    normalizedName: text("normalized_name").notNull(),
    city: text("city"),
    state: text("state"),
    geoKey: text("geo_key").notNull(),
    // First-class tag (R17). Defaults to `unclassified` — the honest "not yet
    // classified" state; U5's resolver sets the real vertical.
    vertical: vertical("vertical").notNull().default("unclassified"),
    enrichmentStatus: enrichmentStatus("enrichment_status")
      .notNull()
      .default("pending"),
    ehr: text("ehr"),
    locationsCount: integer("locations_count"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("practices_normalized_geo_uq").on(t.normalizedName, t.geoKey),
  ],
);

/**
 * Evidence — the citation-contract atom (R5). Every fact traces to one of these:
 * a source URL, a supporting snippet, a confidence, and a detected-at timestamp.
 */
export const evidence = pgTable("evidence", {
  id: uuid("id").primaryKey().defaultRandom(),
  sourceUrl: text("source_url").notNull(),
  snippet: text("snippet"),
  confidence: numeric("confidence"),
  detectedAt: timestamp("detected_at", { withTimezone: true }),
  createdAt: createdAt(),
});

export const signals = pgTable(
  "signals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    practiceId: uuid("practice_id")
      .notNull()
      .references(() => practices.id),
    kind: signalKind("kind").notNull(),
    evidenceId: uuid("evidence_id")
      .notNull()
      .references(() => evidence.id),
    confidence: numeric("confidence"),
    detectedAt: timestamp("detected_at", { withTimezone: true }),
    // Freshness window — a signal past `expires_at` is treated as a signal change
    // (KTD: stored briefs never claim a stale signal count).
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    // First-class signal-source tag (R1).
    signalSource: text("signal_source"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("signals_practice_kind_evidence_uq").on(
      t.practiceId,
      t.kind,
      t.evidenceId,
    ),
  ],
);

/**
 * Contacts — BUSINESS people only: the practice's decision-maker (name, role,
 * public LinkedIn). D9 / R17: ZERO PHI — no patient is ever represented here.
 */
export const contacts = pgTable("contacts", {
  id: uuid("id").primaryKey().defaultRandom(),
  practiceId: uuid("practice_id")
    .notNull()
    .references(() => practices.id),
  // null = role-only variant (no resolved person) — D9's honest fallback.
  name: text("name"),
  role: text("role").notNull(),
  linkedinUrl: text("linkedin_url"),
  bestChannel: text("best_channel"),
  personalizationSnippet: text("personalization_snippet"),
  sourceUrl: text("source_url"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});
