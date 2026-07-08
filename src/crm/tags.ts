import type { LeadInput, LeadTags } from "./adapter";
import { INITIAL_DEAL_STAGE_ID } from "./stages";

/**
 * Pure mapping from the CRM-agnostic lead shape to HubSpot property bags (R8).
 * No I/O, no HubSpot client — so every mapping rule unit-tests without a mock.
 * `hubspot-properties.ts` provisions exactly the properties this module writes to.
 */

/** "custom" = one HubSpot property per tag; "prefixed" = all four packed into
 *  a single text property. The prefixed mode is the DEFENSIVE fallback if a
 *  portal's custom-property budget can't take four new props. */
export type PropertyMode = "custom" | "prefixed";

export const TAG_PROPERTY_KEYS = {
  vertical: "vertical",
  signalSource: "signal_source",
  signalCount: "signal_count",
  aeQuality: "ae_quality",
} as const;

/** Single text property used by the "prefixed" fallback mode. */
export const PREFIXED_TAG_KEY = "bme_tags";

type Props = Record<string, string>;

function dropEmpty(input: Record<string, string | null | undefined>): Props {
  const out: Props = {};
  for (const [k, v] of Object.entries(input)) {
    if (v !== null && v !== undefined && v !== "") out[k] = v;
  }
  return out;
}

/** Encode the four tags to HubSpot properties per the configured mode (pure). */
export function encodeTags(tags: Partial<LeadTags>, mode: PropertyMode): Props {
  const pairs: Array<[string, string | number | null | undefined]> = [
    [TAG_PROPERTY_KEYS.vertical, tags.vertical],
    [TAG_PROPERTY_KEYS.signalSource, tags.signalSource],
    [TAG_PROPERTY_KEYS.signalCount, tags.signalCount],
    [TAG_PROPERTY_KEYS.aeQuality, tags.aeQuality],
  ];
  if (mode === "prefixed") {
    const encoded = pairs
      .filter(([, v]) => v !== null && v !== undefined && v !== "")
      .map(([k, v]) => `${k}=${String(v)}`)
      .join(";");
    return encoded ? { [PREFIXED_TAG_KEY]: encoded } : {};
  }
  const out: Props = {};
  for (const [k, v] of pairs) {
    if (v !== null && v !== undefined && v !== "") out[k] = String(v);
  }
  return out;
}

function splitName(name?: string | null): {
  firstname?: string;
  lastname?: string;
} {
  if (!name) return {};
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return { firstname: parts[0] };
  return { firstname: parts[0], lastname: parts.slice(1).join(" ") };
}

export function companyProperties(lead: LeadInput, mode: PropertyMode): Props {
  return dropEmpty({
    name: lead.companyName,
    domain: lead.domain,
    city: lead.city,
    state: lead.state,
    ...encodeTags(lead.tags, mode),
  });
}

export function contactProperties(lead: LeadInput): Props {
  const c = lead.contact;
  const { firstname, lastname } = splitName(c?.name);
  return dropEmpty({
    email: c?.email,
    firstname,
    lastname,
    jobtitle: c?.role,
    // Verified live 2026-07-08: `hs_linkedin_url` is a HubSpot-defined contact
    // property, so it needs no provisioning.
    hs_linkedin_url: c?.linkedinUrl,
  });
}

export function dealProperties(lead: LeadInput, mode: PropertyMode): Props {
  return dropEmpty({
    dealname: `${lead.companyName} — buying moment`,
    // `dealstage` — not `pipeline` — is what places a deal in a pipeline. Verified
    // live: sending `pipeline` alone leaves BOTH null and the deal enters no
    // pipeline, so no stage and no cycle time can ever be read back.
    dealstage: INITIAL_DEAL_STAGE_ID,
    ...encodeTags(lead.tags, mode),
  });
}
