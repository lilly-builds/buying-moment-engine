import { index, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * Activity domain — first-party product analytics for the deployed app.
 *
 * Why first-party (not PostHog/Segment): the visitors we most want to see are
 * enterprise GTM orgs, exactly the population whose corporate networks and
 * hardened browsers block third-party analytics. Logging server-side into our
 * own Postgres can't be blocked, keeps real prospect emails inside our infra
 * (R18's "public repo with real business-contact data" posture), and reuses the
 * DATABASE_URL / Drizzle path every other table already trusts.
 *
 * Two capture points, both Node-runtime (postgres-js can't run on the Edge, so
 * this is never logged from `proxy.ts`):
 *   - sign_in   — `app/auth/callback/route.ts`, right after a successful,
 *                 allowlisted magic-link exchange. Unblockable; the exact
 *                 "who signed in, from what org" moment.
 *   - page_view — `app/api/track`, hit by the client tracker on each route
 *                 change. First-party same-origin, so adblock leaves it alone.
 *
 * RLS: like every table here, deny-by-default with no public policy. Only the
 * server (table owner over DATABASE_URL) reads/writes it.
 */

export const activityEventType = pgEnum("activity_event_type", [
  "sign_in",
  "page_view",
]);

export const activityEvents = pgTable(
  "activity_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Event time. timestamptz + defaultNow, matching R17's audit-column contract.
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    eventType: activityEventType("event_type").notNull(),
    // WHO — the authenticated Supabase email, always resolved server-side from the
    // session, never accepted from the client (an unauthenticated body can't forge it).
    email: text("email").notNull(),
    // FROM WHAT ORG — the lowercased email domain, the natural org key for this app
    // (the auth allowlist itself keys on `@domain`).
    orgDomain: text("org_domain").notNull(),
    // WHAT — the app path visited. Null only for a sign_in with no known landing path.
    path: text("path"),
    // Supabase user id when present. Nullable; `email` is the stable identity key.
    userId: text("user_id"),
    // Captured so a later report can separate real navigations from prefetch/bot
    // noise. Stored today; not yet used as a filter.
    userAgent: text("user_agent"),
  },
  (t) => [
    index("activity_events_occurred_at_idx").on(t.occurredAt),
    index("activity_events_org_domain_idx").on(t.orgDomain),
  ],
);
