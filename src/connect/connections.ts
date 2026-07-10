/**
 * src/connect/connections.ts — pure helpers behind the RevOps "Connections"
 * onboarding surface (U17 · Thread 08).
 *
 * Everything here is PURE (no React, no I/O) so the server page, the client
 * island, and Vitest can all import it — the value/status logic is unit-tested
 * without a browser (the repo has no component-render infra).
 *
 * Two concerns live here:
 *   1. The value-first opener's honest numbers (real hot-lead count → copy;
 *      the first live-brief link) — this file's first half.
 *   2. The connection checklist's data model + status/go-live derivation — added
 *      alongside the checklist UI (see `CONNECTIONS` below).
 */

// ── Value-first opener helpers ────────────────────────────────────────────────

/**
 * The first live brief to open from the opener — the single most persuasive
 * artifact ("show, don't tell", onboarding-design §1). Takes the feed rows the
 * page already loads and points at the real practice route (`/practice/[id]`);
 * `null` when the feed is empty so the opener degrades to the feed link instead.
 * Structurally typed on `{ id }` so it never couples to the full `FeedRow`.
 */
export function firstBriefHref(rows: readonly { id: string }[]): string | null {
  const first = rows[0];
  return first ? `/practice/${first.id}` : null;
}

/** The opener's lead-value framing — the REAL number, never a fabricated one. */
export interface LeadValue {
  /** True when there's at least one real hot lead to headline. */
  hasLeads: boolean;
  /** The floored, non-negative count. */
  count: number;
  /** The noun phrase for the count ("12 hot leads" / "1 hot lead"); "" when none. */
  phrase: string;
}

/**
 * Describe the real hot-lead count for the opener. Zero/unknown → `hasLeads:
 * false` so the opener shows the honest no-number framing (never a fake tally,
 * per the ship-today decision + design §7). Guards NaN / negatives defensively.
 */
export function describeLeadValue(count: number): LeadValue {
  const n = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
  if (n === 0) return { hasLeads: false, count: 0, phrase: "" };
  return {
    hasLeads: true,
    count: n,
    phrase: `${n} hot ${n === 1 ? "lead" : "leads"}`,
  };
}
