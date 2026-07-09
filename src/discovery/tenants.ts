import { z } from "zod";
import { PACK_VERTICALS } from "@/src/packs";
import { DETECTOR_KINDS } from "@/src/ingest/validate";

/**
 * Tenant profiles (U4) — the ONE place a tenant's discovery run is parameterized:
 * which metros to rotate through, which ICP categories to enumerate (each mapped to
 * a vertical), what a qualifying review looks like, which signal kind to emit, and
 * the funnel/cache/rotation knobs. Swapping any of these swaps the WHOLE behaviour
 * with no pipeline code change (R8) — that is what "multi-tenant" means at this
 * config level (K2). Production replaces this hand-authored module with a DB-backed,
 * UI-editable table; per-org data isolation is deferred (plan Scope Boundaries).
 *
 * Pure data + validate-on-access, mirroring `src/packs/` — a malformed profile must
 * never ship silently (the fail-loud pattern of `src/ingest/validate.ts`).
 *
 * Feed-reachability is STRUCTURAL (K7): `icp.vertical` is constrained to the four
 * PACK_VERTICALS, which are exactly the non-`unclassified` verticals the feed
 * admits (`db/queries.ts` excludes `unclassified`). A profile therefore cannot map
 * an ICP to a vertical that would silently vanish from the feed.
 */

export const tenantProfileSchema = z.object({
  id: z.string().min(1),
  /** Human metro strings, e.g. "Austin, TX" — the Google query subject + rotation set. */
  metros: z.array(z.string().min(1)).min(1),
  /** ICP categories, each pinned to a feed-reachable vertical (K7). */
  icp: z
    .array(
      z.object({
        category: z.string().min(1),
        vertical: z.enum(PACK_VERTICALS),
      }),
    )
    .min(1),
  /** The swappable review criterion handed to the LLM qualifier (U3). */
  qualificationPrompt: z.string().min(1),
  /** Which signal a qualified place emits onto the feed — one of the 4 DetectorKinds. */
  signalKind: z.enum(DETECTOR_KINDS),
  /** Places rated at/above this are funnel-dropped before the expensive step (R2). */
  ratingThreshold: z.number().min(0).max(5),
  /** Cache window: a place pulled within this many days is skipped on the next run (R7). */
  rePullWindowDays: z.number().int().positive(),
  /** Clock-derived metro rotation (U6): a fixed anchor + a cadence in days. */
  rotation: z.object({
    anchorISO: z.string().min(1),
    cadenceDays: z.number().int().positive(),
  }),
});

export type TenantProfileInput = z.input<typeof tenantProfileSchema>;
export type TenantProfile = z.output<typeof tenantProfileSchema>;

/**
 * EliseAI — healthcare AI phone-comms. It hunts practices whose reviews evidence
 * front-desk phone-access failure (the pain its product removes), across a rotating
 * set of metros, one signal kind (`phone_complaints`) into the existing feed.
 *
 * `rePullWindowDays: 90` matches the `phone_complaints` freshness window
 * (`src/engine/freshness.ts`) — do not re-pay for a place more often than its
 * emitted signal stays fresh.
 *
 * `ratingThreshold: 4.9` was TUNED from the first live run (2026-07-09): the top
 * Google results for a metro's ICP cluster at 4.6-5.0 with hundreds-to-thousands of
 * reviews each, so a 4.8-star practice still carries ~100+ one-star reviews where
 * phone-access pain lives. Phone pain is orthogonal to overall rating; the funnel's
 * real job is only to skip the near-perfect (>= 4.9) tail for cost, not to pre-judge
 * on stars. A place Details lookup is cheap (~4¢, 5 reviews), so checking broadly is
 * affordable. Tune further from live metrics (Open Questions).
 */
const eliseaiProfile: TenantProfileInput = {
  id: "eliseai",
  metros: ["Austin, TX", "Tampa, FL", "Charlotte, NC"],
  icp: [
    { category: "dermatology", vertical: "dermatology" },
    { category: "women's health clinic", vertical: "womens_health" },
    { category: "ophthalmology", vertical: "ophthalmology" },
    { category: "orthopedic clinic", vertical: "orthopedics" },
  ],
  qualificationPrompt:
    "The reviewer describes a first-hand problem reaching this practice by phone or getting a timely response to a call: long hold times, calls that ring out or go unanswered, being unable to get through, no callback after leaving a message, or a full/broken voicemail. This is front-desk phone-access and patient-communication failure — NOT in-person waiting-room waits, billing disputes, or clinical/bedside-manner complaints.",
  signalKind: "phone_complaints",
  ratingThreshold: 4.9,
  rePullWindowDays: 90,
  rotation: { anchorISO: "2026-01-05T00:00:00Z", cadenceDays: 7 },
};

const RAW_TENANTS: Record<string, unknown> = {
  eliseai: eliseaiProfile,
};

/** All tenant ids this build ships. */
export const KNOWN_TENANT_IDS = Object.keys(RAW_TENANTS);

/**
 * Load + validate a tenant profile by id. Throws on an unknown id (fail loud — a
 * typo must not silently run the wrong tenant) and on a malformed profile (mirrors
 * `getPack`).
 */
export function getTenantProfile(id: string): TenantProfile {
  const raw = RAW_TENANTS[id];
  if (raw === undefined) {
    throw new Error(
      `unknown tenant "${id}" (known: ${KNOWN_TENANT_IDS.join(", ") || "none"})`,
    );
  }
  const parsed = tenantProfileSchema.safeParse(raw);
  if (!parsed.success) {
    const reason = parsed.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    throw new Error(`tenant "${id}" failed validation: ${reason}`);
  }
  return parsed.data;
}
