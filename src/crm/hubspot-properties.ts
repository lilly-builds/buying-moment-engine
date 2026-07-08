import {
  createHubSpotRequest,
  isTolerated,
  type HubSpotHttpDeps,
} from "./hubspot-http";
import { PREFIXED_TAG_KEY, TAG_PROPERTY_KEYS, type PropertyMode } from "./tags";

/**
 * Provision the custom properties the four first-class tags live in (R8, U10).
 *
 * WHY THIS EXISTS: HubSpot rejects a write to a property that does not exist —
 * `400 PROPERTY_DOESNT_EXIST` — so `pushLead` cannot land a single tagged record
 * on a fresh portal until these are created. Verified against a live portal
 * 2026-07-08: the exact `companyProperties()` payload returned 400 before this
 * ran and 201 after.
 *
 * IDEMPOTENT BY CONTRACT (R17 — never blindly overwrite a real record): creating
 * a group or property that already exists returns 409, which we tolerate as
 * "already provisioned" rather than PATCHing over a definition an admin may have
 * customised. Verified live: group re-create -> 409; property re-create -> 409
 * `OBJECT_ALREADY_EXISTS`.
 *
 * Called once per connect (`completeHubSpotConnect`), so the "Connect HubSpot"
 * grant leaves the portal ready to receive leads.
 */

export const LEAD_PROPERTY_GROUP = "gtm_maestro";
const LEAD_PROPERTY_GROUP_LABEL = "GTM Maestro";

/** The objects that carry the tags (companies + deals — see `encodeTags`). */
export const TAGGED_OBJECT_TYPES = ["companies", "deals"] as const;
export type TaggedObjectType = (typeof TAGGED_OBJECT_TYPES)[number];

export interface PropertyOption {
  label: string;
  value: string;
  displayOrder: number;
}

export interface PropertyDef {
  name: string;
  label: string;
  type: "string" | "number" | "enumeration";
  fieldType: "text" | "number" | "select";
  options?: PropertyOption[];
}

/** One property per tag — the "custom" mode (`PropertyMode`). */
export const CUSTOM_MODE_PROPERTIES: readonly PropertyDef[] = [
  {
    name: TAG_PROPERTY_KEYS.vertical,
    label: "Vertical",
    type: "string",
    fieldType: "text",
  },
  {
    name: TAG_PROPERTY_KEYS.signalSource,
    label: "Signal source",
    type: "string",
    fieldType: "text",
  },
  {
    // Numeric so HubSpot reports can sort/filter "how hot" without a cast.
    name: TAG_PROPERTY_KEYS.signalCount,
    label: "Signal count",
    type: "number",
    fieldType: "number",
  },
  {
    // Mirrors the `feedback_thumb` pgEnum ("up" | "down") — one vocabulary.
    name: TAG_PROPERTY_KEYS.aeQuality,
    label: "AE lead quality",
    type: "enumeration",
    fieldType: "select",
    options: [
      { label: "Good", value: "up", displayOrder: 0 },
      { label: "Not good", value: "down", displayOrder: 1 },
    ],
  },
] as const;

/** All four tags packed into one text property — the "prefixed" fallback mode. */
export const PREFIXED_MODE_PROPERTIES: readonly PropertyDef[] = [
  {
    name: PREFIXED_TAG_KEY,
    label: "GTM Maestro tags",
    type: "string",
    fieldType: "text",
  },
] as const;

/** The property set a given tag-encoding mode needs to exist (pure). */
export function propertiesForMode(mode: PropertyMode): readonly PropertyDef[] {
  return mode === "prefixed" ? PREFIXED_MODE_PROPERTIES : CUSTOM_MODE_PROPERTIES;
}

/** The create-property request body HubSpot expects (pure). */
export function propertyPayload(def: PropertyDef): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    name: def.name,
    label: def.label,
    type: def.type,
    fieldType: def.fieldType,
    groupName: LEAD_PROPERTY_GROUP,
  };
  if (def.options) payload.options = def.options;
  return payload;
}

export interface EnsurePropertiesDeps extends HubSpotHttpDeps {
  propertyMode?: PropertyMode;
}

export interface EnsurePropertiesResult {
  /** `objectType.propertyName` for each property this call created. */
  created: string[];
  /** `objectType.propertyName` for each that already existed (409). */
  existing: string[];
}

/** HubSpot returns 409 when the group/property is already there. */
const ALREADY_EXISTS = [409] as const;

/**
 * Create the tag property group + properties on every tagged object type, if
 * they are not already there. Safe to call on every connect.
 */
export async function ensureLeadProperties(
  deps: EnsurePropertiesDeps,
): Promise<EnsurePropertiesResult> {
  const request = createHubSpotRequest(deps);
  const defs = propertiesForMode(deps.propertyMode ?? "custom");
  const created: string[] = [];
  const existing: string[] = [];

  for (const objectType of TAGGED_OBJECT_TYPES) {
    // The group must exist before a property can reference it by `groupName`.
    await request(
      "POST",
      `/crm/v3/properties/${objectType}/groups`,
      { name: LEAD_PROPERTY_GROUP, label: LEAD_PROPERTY_GROUP_LABEL },
      { tolerate: ALREADY_EXISTS },
    );

    for (const def of defs) {
      const res = await request(
        "POST",
        `/crm/v3/properties/${objectType}`,
        propertyPayload(def),
        { tolerate: ALREADY_EXISTS },
      );
      const key = `${objectType}.${def.name}`;
      if (isTolerated(res)) existing.push(key);
      else created.push(key);
    }
  }

  return { created, existing };
}
