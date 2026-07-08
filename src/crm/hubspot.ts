import {
  computeCycleTimeDays,
  type CrmAdapter,
  type CrmLinkRef,
  type LeadInput,
  type LeadTags,
  type PushProgress,
  type PushResult,
  type StageReadback,
} from "./adapter";
import { createHubSpotRequest, type HubSpotHttpDeps } from "./hubspot-http";
import { WON_STAGE_ID } from "./stages";
import {
  companyProperties,
  contactProperties,
  dealProperties,
  encodeTags,
  type PropertyMode,
} from "./tags";

/**
 * HubSpot binding of the CRM adapter (R8, R11, U10). Every feed lead lands as a
 * company + contact + deal carrying the four first-class tags. Re-pushing the
 * SAME lead UPDATES in place (idempotent — the caller passes the stored ids from
 * `crm_links`), never duplicates. A 429 is retried with backoff, losing nothing.
 *
 * The tag properties must already exist on the portal — `ensureLeadProperties`
 * (`hubspot-properties.ts`) provisions them at connect time, because HubSpot
 * rejects a write to a property that does not exist (400 PROPERTY_DOESNT_EXIST).
 *
 * PURE logic lives in `tags.ts` (mapping) and `hubspot-http.ts` (backoff); this
 * module only wires them to HTTP.
 */

// Re-exported so callers/tests keep one import site for the HubSpot binding.
export { backoffDelayMs, HUBSPOT_FETCH_TIMEOUT_MS } from "./hubspot-http";
export {
  companyProperties,
  contactProperties,
  dealProperties,
  encodeTags,
  PREFIXED_TAG_KEY,
  TAG_PROPERTY_KEYS,
  type PropertyMode,
} from "./tags";

// ── HubSpot association type ids (HUBSPOT_DEFINED defaults) ───────────────────
// Verified against a live portal 2026-07-08 via
// GET /crm/v4/associations/{from}/{to}/labels — see `docs/hubspot-recon.md`.
const ASSOCIATION_TYPE = {
  contactToCompany: 279,
  dealToCompany: 341,
  dealToContact: 3,
} as const;

/**
 * The per-stage entry timestamp for the won stage. Verified live 2026-07-08:
 * the readable property is `hs_v2_date_entered_<stageId>` — NOT the
 * `hs_date_entered_<stageId>` an earlier note assumed.
 */
export const WON_STAGE_ENTERED_PROPERTY = `hs_v2_date_entered_${WON_STAGE_ID}`;

const DEAL_READ_PROPERTIES = [
  "dealstage",
  "createdate",
  "closedate",
  WON_STAGE_ENTERED_PROPERTY,
] as const;

function assoc(toId: string, typeId: number) {
  return {
    to: { id: toId },
    types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: typeId }],
  };
}

interface BatchUpsertResponse {
  results?: Array<{ id: string; new?: boolean }>;
}

// ── The binding ──────────────────────────────────────────────────────────────

export interface HubSpotDeps extends HubSpotHttpDeps {
  propertyMode?: PropertyMode;
}

interface HubSpotObject {
  id: string;
  properties?: Record<string, string>;
}

function parseDate(value: string | undefined | null): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function createHubSpotAdapter(deps: HubSpotDeps): CrmAdapter {
  const mode = deps.propertyMode ?? "custom";
  const rawRequest = createHubSpotRequest(deps);
  // This adapter never tolerates a status, so narrow the tolerated union away.
  const request = rawRequest as <T>(
    method: string,
    path: string,
    body?: unknown,
  ) => Promise<T>;

  /**
   * Land the decision-maker as a contact and associate them to the practice.
   *
   * HubSpot DEDUPES contacts on `email`: a plain create for an address already in
   * the portal answers `409 CONFLICT — Contact already exists` (verified live
   * 2026-07-08). That is the ordinary case, not an edge case — a real AE's CRM
   * already holds the people we're enriching — and it would abort the whole push,
   * leaving a company with no contact and no deal. So when we have an email we
   * UPSERT on it (`batch/upsert` + `idProperty: email`), which creates or updates
   * and never conflicts.
   *
   * `batch/upsert` takes no `associations`, so the contact→company link goes
   * through the v4 default-association PUT, which is itself idempotent (verified
   * live: two PUTs, one association, typeId 279).
   *
   * With no email there is no dedupe key, so a plain create with an inline
   * association is both correct and the only option.
   */
  async function resolveContact(
    lead: LeadInput,
    existingContactId: string | null | undefined,
    companyId: string,
  ): Promise<string> {
    const properties = contactProperties(lead);

    if (existingContactId) {
      const patched = await request<HubSpotObject>(
        "PATCH",
        `/crm/v3/objects/contacts/${existingContactId}`,
        { properties },
      );
      return patched.id;
    }

    const email = lead.contact?.email;
    if (!email) {
      const created = await request<HubSpotObject>(
        "POST",
        "/crm/v3/objects/contacts",
        {
          properties,
          associations: [assoc(companyId, ASSOCIATION_TYPE.contactToCompany)],
        },
      );
      return created.id;
    }

    const upserted = await request<BatchUpsertResponse>(
      "POST",
      "/crm/v3/objects/contacts/batch/upsert",
      { inputs: [{ idProperty: "email", id: email, properties }] },
    );
    const contactId = upserted.results?.[0]?.id;
    if (!contactId) {
      throw new Error("HubSpot contact upsert returned no id");
    }
    await request(
      "PUT",
      `/crm/v4/objects/contacts/${contactId}/associations/default/companies/${companyId}`,
    );
    return contactId;
  }

  async function pushLead(
    lead: LeadInput,
    existing?: CrmLinkRef | null,
    onProgress?: PushProgress,
  ): Promise<PushResult> {
    const created = !existing?.companyId;
    const ref: CrmLinkRef = {
      companyId: existing?.companyId ?? undefined,
      contactId: existing?.contactId ?? undefined,
      dealId: existing?.dealId ?? undefined,
    };

    // Company (the practice entity) — carries all four tags.
    const company = existing?.companyId
      ? await request<HubSpotObject>(
          "PATCH",
          `/crm/v3/objects/companies/${existing.companyId}`,
          { properties: companyProperties(lead, mode) },
        )
      : await request<HubSpotObject>("POST", "/crm/v3/objects/companies", {
          properties: companyProperties(lead, mode),
        });
    ref.companyId = company.id;
    if (onProgress) await onProgress({ ...ref });

    // Contact — the business decision-maker, associated to the company.
    const contactId = await resolveContact(lead, existing?.contactId, company.id);
    ref.contactId = contactId;
    if (onProgress) await onProgress({ ...ref });

    // Deal — also tagged so pipeline reports slice by vertical/source (R8).
    const deal = existing?.dealId
      ? await request<HubSpotObject>(
          "PATCH",
          `/crm/v3/objects/deals/${existing.dealId}`,
          { properties: dealProperties(lead, mode) },
        )
      : await request<HubSpotObject>("POST", "/crm/v3/objects/deals", {
          properties: dealProperties(lead, mode),
          associations: [
            assoc(company.id, ASSOCIATION_TYPE.dealToCompany),
            assoc(contactId, ASSOCIATION_TYPE.dealToContact),
          ],
        });
    ref.dealId = deal.id;
    if (onProgress) await onProgress({ ...ref });

    return {
      companyId: company.id,
      contactId,
      dealId: deal.id,
      created,
    };
  }

  async function tagLead(
    ref: CrmLinkRef,
    tags: Partial<LeadTags>,
  ): Promise<void> {
    const properties = encodeTags(tags, mode);
    if (Object.keys(properties).length === 0) return;
    // ae_quality lives on both the company and the deal so either object's
    // reports reflect the AE's 👍/👎 verdict (R8).
    if (ref.companyId) {
      await request("PATCH", `/crm/v3/objects/companies/${ref.companyId}`, {
        properties,
      });
    }
    if (ref.dealId) {
      await request("PATCH", `/crm/v3/objects/deals/${ref.dealId}`, {
        properties,
      });
    }
  }

  async function recordStage(ref: CrmLinkRef): Promise<StageReadback> {
    if (!ref.dealId) {
      return { stage: "", enteredAt: null, closedAt: null, cycleTimeDays: null };
    }
    const deal = await request<HubSpotObject>(
      "GET",
      `/crm/v3/objects/deals/${ref.dealId}?properties=${DEAL_READ_PROPERTIES.join(",")}`,
    );
    const props = deal.properties ?? {};
    const enteredAt = parseDate(props.createdate);
    // `closedate` is set for closed-LOST too, so it can never mark a win. The
    // cycle we report is "deal created -> deal WON"; an open or lost deal has no
    // cycle time rather than a fabricated one (KTD: never claim an unsourceable
    // number). Verified live: the readable stage-entry property is
    // `hs_v2_date_entered_closedwon`.
    const closedAt = parseDate(props[WON_STAGE_ENTERED_PROPERTY]);
    return {
      stage: props.dealstage ?? "",
      enteredAt,
      closedAt,
      cycleTimeDays: computeCycleTimeDays(enteredAt, closedAt),
    };
  }

  return { pushLead, tagLead, recordStage };
}
