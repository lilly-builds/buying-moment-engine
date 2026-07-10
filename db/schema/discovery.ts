import {
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { createdAt, updatedAt } from "./columns";

/**
 * Discovery domain (U2) — the ONE store for every place the Google Places
 * enumeration surfaces, serving three roles at once (K5) so we do not stand up
 * three separate tables:
 *
 *  1. ARCHIVE lane — a place that did not qualify (funnel-dropped, or checked and
 *     found no signal) is RETAINED, not thrown away, so a later rotation can
 *     resurface it if its reviews change (the `checked-no-signal -> qualified`
 *     transition, R7).
 *  2. RE-PULL CACHE — `last_pulled_at` gates the EXPENSIVE step (Details + reviews
 *     + LLM). A place pulled within the freshness window is skipped on the next
 *     run, so discovery does not keep paying ~4¢ + tokens to re-check the same
 *     place every rotation (K6/R7).
 *  3. DISCOVERY LOG — one row per enumerated place, with its latest verdict.
 *
 * Google ToS (R5): this table stores ONLY `place_id` (the identifier Google
 * permits long-lived) plus PUBLIC listing facts (name, rating, count) and OUR OWN
 * derived verdict/kind. It never holds a word of any review's text — enforced at
 * the write boundary (`db/discovery.ts`), which has no review-text field to set.
 *
 * `tenant_id` is a plain string column for cheap forward-compat (K2): the demo
 * runs config-level tenancy on the existing global data plane, and true per-org
 * data isolation is deferred (plan Scope Boundaries).
 *
 * RLS: enabled with NO policy (deny-by-default), matching every other table — see
 * the schema-barrel header. All access is server-mediated over DATABASE_URL.
 */

export const discoveryCandidates = pgTable("discovery_candidates", {
  // The natural key. Google's ToS permits storing this long-lived; it is also the
  // cache/upsert conflict target, so it is the primary key directly (no surrogate).
  placeId: text("place_id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  // Human practice name — public listing fact, never a UUID.
  name: text("name").notNull(),
  geoKey: text("geo_key").notNull(),
  // The vertical this place maps to under the tenant's ICP (K7). Nullable: a
  // funnel-dropped place we never classified carries none.
  vertical: text("vertical"),
  // Public listing score. numeric (postgres) round-trips as a string.
  rating: numeric("rating"),
  reviewCount: integer("review_count"),
  // The cache hand: when we last pulled Details+reviews. NULL = never pulled
  // (funnel-dropped before the expensive step) — treated as "not fresh, do pull".
  lastPulledAt: timestamp("last_pulled_at", { withTimezone: true }),
  // Our derived verdict — see DISCOVERY_VERDICTS in `db/discovery.ts`. Never a review.
  lastVerdict: text("last_verdict").notNull(),
  // The signal kind emitted when this place qualified, else NULL.
  qualifiedKind: text("qualified_kind"),
  // When discovery first saw this place. NOT NULL — provenance on every row (R17).
  detectedAt: timestamp("detected_at", { withTimezone: true }).notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}).enableRLS();
