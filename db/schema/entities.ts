import {
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

/**
 * Which enrichment provider supplied a fact (U5's Claude -> PDL waterfall,
 * spec § Stack). Claude's facts always carry an evidence row (D2 citation
 * contract); PDL's fill only the verified email + LinkedIn gap.
 */
export const enrichmentProvider = pgEnum("enrichment_provider", [
  "claude_research",
  "pdl",
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
    // The scrape SEED for enrichment (the practice's own homepage), not a cited
    // brief fact. Sourced upstream — "if the lead source hands us a website, keep
    // it" (Google Places on the call we already make), else a deliberate Places
    // name-lookup fills it (see `src/enrich/website.ts`). Deliberately NOT in
    // `practice_facts`: the brief's CITED `website` fact still comes from verified
    // extraction (D2), so this bare hint carries no provenance and never collides
    // with that fact's (practice, field) unique key. Nullable — a practice we
    // cannot find a site for enriches thin, honestly, and never blocks.
    websiteUrl: text("website_url"),
    // First-class tag (R17). Defaults to `unclassified` — the honest "not yet
    // classified" state; U5's resolver sets the real vertical.
    vertical: vertical("vertical").notNull().default("unclassified"),
    // `pending` covers "not enriched yet" AND "mid-waterfall" — U8's pull-mode
    // progress UI reads it. No new enum value: a practice in flight is pending.
    enrichmentStatus: enrichmentStatus("enrichment_status")
      .notNull()
      .default("pending"),
    // NOTE (U5): `ehr` and `locations_count` used to live here as bare text/int.
    // They carried NO provenance, so they could never satisfy D2/R5 ("the brief
    // never states an uncited fact") or U6's requirement that each factual field
    // carry its evidence id + source URL. They now live in `practice_facts`,
    // each row FK'd to an `evidence` row. Keeping both would duplicate data
    // across tables, which R17 forbids.
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("practices_normalized_geo_uq").on(t.normalizedName, t.geoKey),
  ],
).enableRLS();

/**
 * Evidence — the citation-contract atom (R5). Every fact traces to one of these:
 * a source URL, a supporting snippet, a confidence, and a detected-at timestamp.
 */
export const evidence = pgTable("evidence", {
  id: uuid("id").primaryKey().defaultRandom(),
  sourceUrl: text("source_url").notNull(),
  snippet: text("snippet"),
  confidence: numeric("confidence"),
  // NOT NULL (U5): R17 wants provenance — source URL AND the timestamp it was
  // detected — on every fact. No default: an inventing default would fabricate
  // provenance, so every writer must state when it saw the claim.
  detectedAt: timestamp("detected_at", { withTimezone: true }).notNull(),
  createdAt: createdAt(),
}).enableRLS();

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
    // NOT NULL (U5) — see `evidence.detected_at`. Freshness (U3) and the feed's
    // decayed rank both read this; a null would silently mean "never decays".
    detectedAt: timestamp("detected_at", { withTimezone: true }).notNull(),
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
).enableRLS();

/**
 * practice_facts (U5) — the citation-carrying store for enrichment firmographics
 * (specialty, locations count, provider count, EHR, incumbent tooling, buying-moment
 * context). ONE row per (practice, field), each FK'd to the `evidence` row that
 * proves it. This is what lets U6 render "every claim underline-linked to its
 * source" (D2/R5) for a firmographic, not just for a signal.
 *
 * Values are stored as `text` deliberately: the brief renders them verbatim next
 * to their citation, and a typed column would invite a value that no longer
 * matches its snippet. R17's "raw vs derived" line: this is normalized fact +
 * provenance, never a derived score.
 */
export const practiceFacts = pgTable(
  "practice_facts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    practiceId: uuid("practice_id")
      .notNull()
      .references(() => practices.id),
    field: text("field").notNull(),
    value: text("value").notNull(),
    evidenceId: uuid("evidence_id")
      .notNull()
      .references(() => evidence.id),
    provider: enrichmentProvider("provider").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [unique("practice_facts_practice_field_uq").on(t.practiceId, t.field)],
).enableRLS();

/**
 * Contacts — BUSINESS people only: the practice's decision-maker (name, role,
 * public LinkedIn, public work email). D9 / R17: ZERO PHI — no patient is ever
 * represented here.
 *
 * Provider columns record WHICH half of the waterfall supplied each field, so
 * experiment #1's per-field split is measurable from the data itself rather than
 * inferred. `source_url` stays the page Claude cited for name/role.
 */
export const contacts = pgTable("contacts", {
  id: uuid("id").primaryKey().defaultRandom(),
  practiceId: uuid("practice_id")
    .notNull()
    .references(() => practices.id),
  // null = role-only variant (no resolved person) — D9's honest fallback.
  name: text("name"),
  role: text("role").notNull(),
  // null in the role-only variant — a practice with no findable contact degrades,
  // it never fails, and it never invents an address.
  email: text("email"),
  emailProvider: enrichmentProvider("email_provider"),
  linkedinUrl: text("linkedin_url"),
  linkedinProvider: enrichmentProvider("linkedin_provider"),
  bestChannel: text("best_channel"),
  personalizationSnippet: text("personalization_snippet"),
  sourceUrl: text("source_url"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}).enableRLS();
