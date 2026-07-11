import { index, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";
import { createdAt } from "./columns";

/**
 * Marketing / top-of-funnel tables for the landing-page GTM experiments
 * (the three /for/[niche] pages). These are SEPARATE from the product's
 * operational tables on purpose: they hold cold-visitor demand, never product
 * data, and are written by PUBLIC, unauthenticated routes (the only such routes
 * in the app). RLS is enabled with no public policy, exactly like every other
 * table — the public capture routes write through the server's owner connection
 * (DATABASE_URL), so the browser/anon client can never read or write these.
 *
 * Two tables, two jobs:
 *   waitlist_signups  — the durable LEAD list (email + what they sell). This is
 *                       the asset: real people who raised a hand, tagged by which
 *                       landing variant and traffic source converted them.
 *   marketing_events  — the FUNNEL log (one row per page view and per signup),
 *                       so conversion rate per variant is a real query, not a
 *                       guess. This is how the A/B test is actually read.
 */

/**
 * waitlist_signups — a hand raised on a landing page.
 *
 * `variant` is the experiment cell (the landing slug: "saas" | "outbound" |
 * "founders"), so we can compare which positioning converts. `whatYouSell` is
 * the single most valuable field we can capture: it is the exact input the
 * product runs on, it qualifies the lead, and it seeds the personalized
 * follow-up. Optional so it never blocks the email capture.
 *
 * UTM columns record the traffic SOURCE (which marketing channel drove them),
 * so we can read channel x variant, not just variant.
 */
export const waitlistSignups = pgTable(
  "waitlist_signups",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Work email — the one required field.
    email: text("email").notNull(),
    // Which landing variant converted them: "saas" | "outbound" | "founders".
    variant: text("variant").notNull(),
    // Optional: the one line the product needs — "what do you sell?".
    whatYouSell: text("what_you_sell"),
    // Traffic source (marketing channel attribution).
    utmSource: text("utm_source"),
    utmMedium: text("utm_medium"),
    utmCampaign: text("utm_campaign"),
    // The page/referrer they arrived from, for debugging attribution.
    referrer: text("referrer"),
    createdAt: createdAt(),
  },
  (t) => [
    index("waitlist_signups_variant_idx").on(t.variant),
    // One row per email per landing variant. Makes a repeat submit (or a bot
    // replaying the same email) idempotent instead of a duplicate lead, so the
    // lead list and the conversion count stay clean.
    unique("waitlist_signups_email_variant_uq").on(t.email, t.variant),
  ],
).enableRLS();

/**
 * marketing_events — the funnel log. One row per meaningful event so the
 * experiment readout (views, signups, conversion rate) is a deliberate query
 * over real rows, not an inference.
 *
 * `eventType` is "view" | "signup". `sessionId` is an opaque client-generated id
 * (a cookie/localStorage value, never PII) used to de-duplicate views to one per
 * visitor per variant. No email lives here — the lead itself is in
 * waitlist_signups; this table stays PII-free so it can grow without concern.
 */
export const marketingEvents = pgTable(
  "marketing_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // "view" | "signup" — validated against the known set in the route.
    eventType: text("event_type").notNull(),
    // The experiment cell: "saas" | "outbound" | "founders".
    variant: text("variant").notNull(),
    // The path the event fired on (e.g. "/for/saas").
    path: text("path"),
    // Opaque per-visitor id for view de-duplication. Not PII.
    sessionId: text("session_id"),
    utmSource: text("utm_source"),
    utmMedium: text("utm_medium"),
    utmCampaign: text("utm_campaign"),
    createdAt: createdAt(),
  },
  (t) => [
    index("marketing_events_variant_idx").on(t.variant),
    index("marketing_events_type_idx").on(t.eventType),
  ],
).enableRLS();
