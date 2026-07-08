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

/**
 * HubSpot binding of the CRM adapter (R8, R11, U10). Every feed lead lands as a
 * company + contact + deal carrying the four first-class tags. Re-pushing the
 * SAME lead UPDATES in place (idempotent — the caller passes the stored ids from
 * `crm_links`), never duplicates. A 429 is retried with backoff, losing nothing.
 *
 * All I/O is injected: `fetch` (mock in tests), `getAccessToken` (the proactive
 * refresh lives in the token provider), `sleep`/`now` (so backoff tests don't
 * actually wait). No live HubSpot account is needed — U15 does the live smoke.
 *
 * PURE logic (property mapping, backoff timing) is exported and unit-tested with
 * no mocks; the class only wires it to HTTP.
 */

// ── Property mapping (pure) ──────────────────────────────────────────────────

/** "custom" = one HubSpot property per tag; "prefixed" = all four packed into
 *  a single text property. The prefixed mode is the DEFENSIVE fallback if a
 *  portal's custom-property budget can't take four new props (verify in U15). */
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
export function encodeTags(
  tags: Partial<LeadTags>,
  mode: PropertyMode,
): Props {
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

function splitName(name?: string | null): { firstname?: string; lastname?: string } {
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
    hs_linkedin_url: c?.linkedinUrl,
  });
}

export function dealProperties(lead: LeadInput, mode: PropertyMode): Props {
  return dropEmpty({
    dealname: `${lead.companyName} — buying moment`,
    pipeline: "default",
    ...encodeTags(lead.tags, mode),
  });
}

// ── Backoff (pure) ───────────────────────────────────────────────────────────

/**
 * Delay before retrying a 429 (pure). Honors an explicit `Retry-After` (seconds)
 * when HubSpot sends one, else exponential backoff (base * 2^attempt) capped.
 */
export function backoffDelayMs(
  attempt: number,
  baseMs: number,
  retryAfterSeconds?: number | null,
  capMs: number = 30_000,
): number {
  if (retryAfterSeconds != null && Number.isFinite(retryAfterSeconds)) {
    return Math.min(retryAfterSeconds * 1000, capMs);
  }
  return Math.min(baseMs * 2 ** attempt, capMs);
}

// ── HubSpot association type ids (HUBSPOT_DEFINED defaults) ───────────────────
// Verify these against the live portal in U15 — default ids can vary per account.
const ASSOCIATION_TYPE = {
  contactToCompany: 279,
  dealToCompany: 341,
  dealToContact: 3,
} as const;

function assoc(toId: string, typeId: number) {
  return {
    to: { id: toId },
    types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: typeId }],
  };
}

// ── The binding ──────────────────────────────────────────────────────────────

export interface HubSpotDeps {
  fetch: typeof fetch;
  /** Returns a VALID access token (the provider refreshes proactively). */
  getAccessToken: () => Promise<string>;
  baseUrl?: string;
  maxRetries?: number;
  /** Base backoff in ms (default 500). */
  backoffBaseMs?: number;
  /** Injected so 429-retry tests don't actually wait. */
  sleep?: (ms: number) => Promise<void>;
  propertyMode?: PropertyMode;
}

interface HubSpotObject {
  id: string;
  properties?: Record<string, string>;
}

const DEFAULT_BASE = "https://api.hubapi.com";

/** Bounded network timeout — a stalled HubSpot response must not hang the live route. */
export const HUBSPOT_FETCH_TIMEOUT_MS = 15_000;

export function createHubSpotAdapter(deps: HubSpotDeps): CrmAdapter {
  const base = deps.baseUrl ?? DEFAULT_BASE;
  const maxRetries = deps.maxRetries ?? 5;
  const backoffBaseMs = deps.backoffBaseMs ?? 500;
  const mode = deps.propertyMode ?? "custom";
  const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));

  async function request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const token = await deps.getAccessToken();
      const res = await deps.fetch(`${base}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(HUBSPOT_FETCH_TIMEOUT_MS),
      });

      if (res.status === 429 && attempt < maxRetries) {
        const retryAfter = res.headers.get("Retry-After");
        await sleep(
          backoffDelayMs(
            attempt,
            backoffBaseMs,
            retryAfter ? Number(retryAfter) : null,
          ),
        );
        continue; // retry — nothing is lost
      }
      if (!res.ok) {
        throw new Error(`HubSpot ${method} ${path} failed with ${res.status}`);
      }
      if (res.status === 204) return undefined as T;
      return (await res.json()) as T;
    }
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
    const contact = existing?.contactId
      ? await request<HubSpotObject>(
          "PATCH",
          `/crm/v3/objects/contacts/${existing.contactId}`,
          { properties: contactProperties(lead) },
        )
      : await request<HubSpotObject>("POST", "/crm/v3/objects/contacts", {
          properties: contactProperties(lead),
          associations: [assoc(company.id, ASSOCIATION_TYPE.contactToCompany)],
        });
    ref.contactId = contact.id;
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
            assoc(contact.id, ASSOCIATION_TYPE.dealToContact),
          ],
        });
    ref.dealId = deal.id;
    if (onProgress) await onProgress({ ...ref });

    return {
      companyId: company.id,
      contactId: contact.id,
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
    // NOTE(U15): createdate -> closedate is a cycle-time PROXY. Per-stage
    // transition timestamps live in `hs_date_entered_<stageId>` — verify those
    // are readable on the live portal for exact meeting->deal cycle time.
    const deal = await request<HubSpotObject>(
      "GET",
      `/crm/v3/objects/deals/${ref.dealId}?properties=dealstage,createdate,closedate`,
    );
    const props = deal.properties ?? {};
    const enteredAt = props.createdate ? new Date(props.createdate) : null;
    const closedAt = props.closedate ? new Date(props.closedate) : null;
    return {
      stage: props.dealstage ?? "",
      enteredAt,
      closedAt,
      cycleTimeDays: computeCycleTimeDays(enteredAt, closedAt),
    };
  }

  return { pushLead, tagLead, recordStage };
}
