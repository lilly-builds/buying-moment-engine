import { timestamp } from "drizzle-orm/pg-core";

/**
 * Reusable audit-trail columns (R17: created/updated timestamps everywhere,
 * timestamptz, defaultNow, and an updated_at that bumps on every write).
 */

export const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());
