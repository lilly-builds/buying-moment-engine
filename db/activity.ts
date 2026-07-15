import { asc, gte } from "drizzle-orm";
import { activityEvents } from "@/db/schema";
import type { Database } from "@/db/types";

/**
 * Activity write + read path (see `db/schema/activity.ts` for the why).
 * `recordActivity` is called from the two Node-runtime capture points;
 * `getActivitySince` feeds the daily report script — it returns raw rows so the
 * report derives every number from them (R17: no stored aggregates, nothing made up).
 */

export type ActivityEventType = "sign_in" | "page_view";

export interface ActivityInput {
  eventType: ActivityEventType;
  /** The authenticated Supabase email — resolved server-side, never client-supplied. */
  email: string;
  path?: string | null;
  userId?: string | null;
  userAgent?: string | null;
}

/**
 * The org a visitor belongs to is the domain of their work email — the same key
 * the auth allowlist uses. Lowercased so `Person@Acme.com` and `person@acme.com`
 * roll up as one org. A malformed address (no `@`) falls back to a visible marker
 * rather than a silent empty string.
 */
export function orgDomainFromEmail(email: string): string {
  const at = email.lastIndexOf("@");
  const domain = at >= 0 ? email.slice(at + 1).trim().toLowerCase() : "";
  return domain.length > 0 ? domain : "(unknown)";
}

export async function recordActivity(
  db: Database,
  input: ActivityInput,
): Promise<void> {
  await db.insert(activityEvents).values({
    eventType: input.eventType,
    email: input.email.trim().toLowerCase(),
    orgDomain: orgDomainFromEmail(input.email),
    path: input.path ?? null,
    userId: input.userId ?? null,
    userAgent: input.userAgent ?? null,
  });
}

export type ActivityRow = typeof activityEvents.$inferSelect;

/** Every event at or after `since`, oldest first. The report aggregates these in code. */
export async function getActivitySince(
  db: Database,
  since: Date,
): Promise<ActivityRow[]> {
  return db
    .select()
    .from(activityEvents)
    .where(gte(activityEvents.occurredAt, since))
    .orderBy(asc(activityEvents.occurredAt));
}
