import type { TenantProfile } from "./tenants";

/**
 * Metro rotation (U6) — which metro batch this run targets (R9). PURE and
 * clock-derived: a fixed anchor + a cadence in the tenant profile yield a stable
 * index into `metros`, so the same `now` always picks the same batch (reproducible,
 * OptiFlow-style `periodsSince(anchor)`). `now` is injected, never read from the wall
 * clock here.
 *
 * Deliberately simple: no persisted rotation-state row (which metro was last run) —
 * a stateless clock derivation cannot drift or double-run, and a persisted cursor is
 * the deferred production upgrade if coverage needs to survive schedule changes.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

function rotationPeriod(tenant: TenantProfile, now: Date): number {
  const anchor = new Date(tenant.rotation.anchorISO).getTime();
  const cadenceMs = tenant.rotation.cadenceDays * DAY_MS;
  return Math.floor((now.getTime() - anchor) / cadenceMs);
}

function euclideanModulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

export function selectMetro(tenant: TenantProfile, now: Date): string {
  const metros = tenant.metros;
  const n = metros.length; // schema guarantees >= 1
  return metros[euclideanModulo(rotationPeriod(tenant, now), n)];
}

export function selectMetroBatch(
  tenant: TenantProfile,
  now: Date,
  requestedCount: number,
): string[] {
  const metros = tenant.metros;
  const n = metros.length; // schema guarantees >= 1
  const count = Math.min(Math.max(Math.floor(requestedCount), 1), n);
  const start = euclideanModulo(rotationPeriod(tenant, now) * count, n);
  return Array.from({ length: count }, (_, offset) => metros[(start + offset) % n]);
}
