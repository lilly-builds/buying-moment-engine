import type { TenantProfile } from "./tenants";

/**
 * Metro rotation (U6) — which single metro this run targets (R9). PURE and
 * clock-derived: a fixed anchor + a cadence in the tenant profile yield a stable
 * index into `metros`, so the same `now` always picks the same metro (reproducible,
 * OptiFlow-style `periodsSince(anchor) % metros.length`). `now` is injected, never
 * read from the wall clock here.
 *
 * Deliberately simple: no persisted rotation-state row (which metro was last run) —
 * a stateless clock derivation cannot drift or double-run, and a persisted cursor is
 * the deferred production upgrade if coverage needs to survive schedule changes.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export function selectMetro(tenant: TenantProfile, now: Date): string {
  const metros = tenant.metros;
  const n = metros.length; // schema guarantees >= 1
  const anchor = new Date(tenant.rotation.anchorISO).getTime();
  const cadenceMs = tenant.rotation.cadenceDays * DAY_MS;

  const periods = Math.floor((now.getTime() - anchor) / cadenceMs);
  // Euclidean modulo so a `now` BEFORE the anchor still lands on a valid index.
  const index = ((periods % n) + n) % n;
  return metros[index];
}
