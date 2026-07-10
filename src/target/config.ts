/**
 * src/target/config.ts — the per-ORG target configuration (U17 · onboarding).
 *
 * These are the values that change from one customer to the next. They live in
 * exactly one place so a new deployment adapts by editing config, never code:
 *
 *   - the product NAME shown in chrome (already `GTM Maestro` across the app),
 *   - the RevOps KEY-OWNER the Send handoff routes to (D14 / onboarding §3),
 *   - the copy for the one credential that flips sending live (HubSpot, per
 *     spec § Stack).
 *
 * WHY THIS EXISTS: the Send gate is a *named, routed handoff* — "Sending turns
 * on once {owner} connects HubSpot." The named owner MUST be a config variable,
 * never a hardcoded "Kyle": a different org has a different RevOps lead, and the
 * gate has to read whoever this deployment's owner is. `eliseai-contact-roster.md`
 * names Kyle Pollak (RevOps Manager, 4× Salesforce-cert) as the smart default —
 * so that ships here as the default, editable per org.
 *
 * Kept pure/synchronous (a plain object, optional env override) so any component
 * — server or client — can import it without a data round-trip.
 */

/** The person who owns connecting the org's own credentials (RevOps). */
export interface RevOpsOwner {
  /** Full name, used where the whole name reads best ("…once Kyle Pollak…"). */
  name: string;
  /** First name, used in the compact routing button ("Send it to Kyle"). */
  firstName: string;
  /** Full role title ("Revenue Operations Manager"). */
  role: string;
  /** Short role label shown beside the name ("RevOps"). */
  shortRole: string;
}

export interface TargetConfig {
  /** The organization this deployment serves. */
  orgName: string;
  /** Product name shown in chrome. */
  productName: string;
  /** The RevOps key-owner the Send handoff routes to. */
  revOpsOwner: RevOpsOwner;
  /**
   * The one credential that flips the Send gate live (spec § Stack: HubSpot
   * OAuth turns on BOTH send + CRM tracking). Named plainly for the 8th-grade
   * gate copy — "connects HubSpot", not "authorizes the OAuth grant".
   */
  connect: {
    /** What the owner connects, in plain words. */
    label: string;
    /** How long it takes, in plain words. */
    effort: string;
  };
}

/**
 * The default target — EliseAI, with Kyle Pollak as the smart-default RevOps
 * owner (roster-confirmed). Override per deployment via `resolveTarget(env)`.
 */
export const DEFAULT_TARGET: TargetConfig = {
  orgName: "EliseAI",
  productName: "GTM Maestro",
  revOpsOwner: {
    name: "Kyle Pollak",
    firstName: "Kyle",
    role: "Revenue Operations Manager",
    shortRole: "RevOps",
  },
  connect: {
    label: "HubSpot",
    effort: "one time, about 5 minutes",
  },
};

/**
 * Resolve the active target, letting env override the owner without a code
 * change (a different org just sets these three vars). Falls back to the
 * roster default so the app is fully configured out of the box.
 */
export function resolveTarget(
  env: Record<string, string | undefined> = process.env,
): TargetConfig {
  const name = env.REVOPS_OWNER_NAME?.trim();
  const role = env.REVOPS_OWNER_ROLE?.trim();
  const shortRole = env.REVOPS_OWNER_SHORT_ROLE?.trim();

  if (!name && !role && !shortRole) return DEFAULT_TARGET;

  const resolvedName = name || DEFAULT_TARGET.revOpsOwner.name;
  return {
    ...DEFAULT_TARGET,
    revOpsOwner: {
      name: resolvedName,
      // Derive the first name from whatever name we resolved.
      firstName: resolvedName.split(/\s+/)[0],
      role: role || DEFAULT_TARGET.revOpsOwner.role,
      shortRole: shortRole || DEFAULT_TARGET.revOpsOwner.shortRole,
    },
  };
}
