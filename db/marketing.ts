import { and, count, eq, sql } from "drizzle-orm";
import type { Database } from "./types";
import { marketingEvents, waitlistSignups } from "./schema";

/**
 * Marketing / top-of-funnel data-layer helpers for the landing experiments.
 * Thin helpers over the two public-capture tables (see db/schema/marketing.ts),
 * mirroring the shape of db/integrations.ts. Each write returns the id so the
 * route can prove the row actually landed (never assert success without proof).
 */

export interface RecordSignupArgs {
  email: string;
  variant: string;
  whatYouSell?: string | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  referrer?: string | null;
}

export async function recordWaitlistSignup(
  db: Database,
  args: RecordSignupArgs,
): Promise<{ id: string }> {
  const [row] = await db
    .insert(waitlistSignups)
    .values({
      email: args.email,
      variant: args.variant,
      whatYouSell: args.whatYouSell ?? null,
      utmSource: args.utmSource ?? null,
      utmMedium: args.utmMedium ?? null,
      utmCampaign: args.utmCampaign ?? null,
      referrer: args.referrer ?? null,
    })
    .returning({ id: waitlistSignups.id });
  return { id: row.id };
}

export interface RecordEventArgs {
  eventType: "view" | "signup";
  variant: string;
  path?: string | null;
  sessionId?: string | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
}

export async function recordMarketingEvent(
  db: Database,
  args: RecordEventArgs,
): Promise<{ id: string }> {
  const [row] = await db
    .insert(marketingEvents)
    .values({
      eventType: args.eventType,
      variant: args.variant,
      path: args.path ?? null,
      sessionId: args.sessionId ?? null,
      utmSource: args.utmSource ?? null,
      utmMedium: args.utmMedium ?? null,
      utmCampaign: args.utmCampaign ?? null,
    })
    .returning({ id: marketingEvents.id });
  return { id: row.id };
}

/**
 * Has this session already been counted as a view for this variant? Keeps the
 * funnel honest by de-duplicating page views to one per visitor per variant.
 */
export async function sessionAlreadyViewed(
  db: Database,
  variant: string,
  sessionId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: marketingEvents.id })
    .from(marketingEvents)
    .where(
      and(
        eq(marketingEvents.eventType, "view"),
        eq(marketingEvents.variant, variant),
        eq(marketingEvents.sessionId, sessionId),
      ),
    )
    .limit(1);
  return Boolean(row);
}

export interface VariantFunnelRow {
  variant: string;
  views: number;
  signups: number;
}

/**
 * The experiment readout: unique-ish views and signups per variant, from which
 * conversion rate is signups / views. Used by scripts/lp-report.ts.
 */
export async function variantFunnel(db: Database): Promise<VariantFunnelRow[]> {
  const views = await db
    .select({
      variant: marketingEvents.variant,
      views: count(marketingEvents.id),
    })
    .from(marketingEvents)
    .where(eq(marketingEvents.eventType, "view"))
    .groupBy(marketingEvents.variant);

  const signups = await db
    .select({
      variant: waitlistSignups.variant,
      signups: count(waitlistSignups.id),
    })
    .from(waitlistSignups)
    .groupBy(waitlistSignups.variant);

  const byVariant = new Map<string, VariantFunnelRow>();
  for (const v of views) {
    byVariant.set(v.variant, {
      variant: v.variant,
      views: Number(v.views),
      signups: 0,
    });
  }
  for (const s of signups) {
    const existing = byVariant.get(s.variant) ?? {
      variant: s.variant,
      views: 0,
      signups: 0,
    };
    existing.signups = Number(s.signups);
    byVariant.set(s.variant, existing);
  }
  return [...byVariant.values()].sort((a, b) => a.variant.localeCompare(b.variant));
}

/** Channel attribution: signups grouped by utm_source. */
export async function signupsBySource(
  db: Database,
): Promise<{ source: string; signups: number }[]> {
  const rows = await db
    .select({
      source: sql<string>`coalesce(${waitlistSignups.utmSource}, 'direct')`,
      signups: count(waitlistSignups.id),
    })
    .from(waitlistSignups)
    .groupBy(sql`coalesce(${waitlistSignups.utmSource}, 'direct')`);
  return rows.map((r) => ({ source: r.source, signups: Number(r.signups) }));
}
