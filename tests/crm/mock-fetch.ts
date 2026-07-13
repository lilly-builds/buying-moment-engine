/**
 * Test helper: a programmable `fetch` mock for the HubSpot REST + OAuth token
 * endpoints. No live account is touched — the adapter/flows run against these
 * recorded shapes (U10).
 *
 * The CRM-object mock ENFORCES HubSpot's real property contract: writing to a
 * property that does not exist answers `400 PROPERTY_DOESNT_EXIST`, and creating
 * a property/group that already exists answers `409`. Both shapes were captured
 * from a live portal on 2026-07-08. Before this, the
 * mock accepted any property bag, which is exactly why ~60 green tests hid a
 * `pushLead` that could never have worked against a real portal.
 */

export interface FetchCall {
  url: string;
  method: string;
  path: string;
  query: URLSearchParams;
  /** Parsed JSON body, or the raw string for form-encoded bodies. */
  body: unknown;
  /** The Authorization header sent (Bearer <token>), or null. */
  authorization: string | null;
}

export interface MockResponse {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
}

export type FetchResponder = (call: FetchCall, index: number) => MockResponse;

export interface MockFetch {
  fetch: typeof fetch;
  calls: FetchCall[];
}

export function mockFetch(responder: FetchResponder): MockFetch {
  const calls: FetchCall[] = [];
  const impl = async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const rawUrl = typeof input === "string" ? input : input.toString();
    const parsed = new URL(rawUrl);
    const method = (init?.method ?? "GET").toUpperCase();
    let body: unknown;
    if (init?.body != null) {
      const asString = String(init.body);
      try {
        body = JSON.parse(asString);
      } catch {
        body = asString;
      }
    }
    const call: FetchCall = {
      url: rawUrl,
      method,
      path: parsed.pathname,
      query: parsed.searchParams,
      body,
      authorization: new Headers(init?.headers).get("authorization"),
    };
    const index = calls.length;
    calls.push(call);
    const r = responder(call, index);
    const responseBody = r.body === undefined ? null : JSON.stringify(r.body);
    return new Response(responseBody, {
      status: r.status ?? 200,
      headers: r.headers,
    });
  };
  return { fetch: impl as unknown as typeof fetch, calls };
}

interface WithProps {
  properties?: Record<string, string>;
}

function propsOf(body: unknown): Record<string, string> | undefined {
  if (typeof body === "object" && body !== null && "properties" in body) {
    return (body as WithProps).properties;
  }
  return undefined;
}

function nameOf(body: unknown): string | undefined {
  if (typeof body === "object" && body !== null && "name" in body) {
    return String((body as { name: unknown }).name);
  }
  return undefined;
}

function idFromPath(path: string): string {
  return path.split("/").filter(Boolean).pop() ?? "";
}

export interface ConnectMockOptions {
  hubId?: number;
  /** Scopes the portal actually GRANTED (a free portal drops the send scope). */
  scopes?: string[];
  /** Fail every property-provisioning call with 403, as a portal missing schema scopes does. */
  propertiesForbidden?: boolean;
  /** The authorizing user's email in the token-meta payload (the sending inbox). */
  user?: string;
  /** The authorizing user's HubSpot user id in the token-meta payload. */
  userId?: number;
  /** Simulate the rare token-info payload that omits user/user_id entirely. */
  omitUser?: boolean;
}

/**
 * The full "Connect HubSpot" surface: token exchange, token-meta lookup, and the
 * property-provisioning routes `completeHubSpotConnect` now calls. Property
 * creates are idempotent (409 on repeat), mirroring the live portal.
 */
export function hubspotConnectMock(opts?: ConnectMockOptions): MockFetch {
  const created = new Set<string>();
  return mockFetch((call) => {
    if (call.path === "/oauth/v1/token") {
      return {
        body: { access_token: "at_live", refresh_token: "rt_live", expires_in: 1800 },
      };
    }
    if (call.path.startsWith("/oauth/v1/access-tokens/")) {
      return {
        body: {
          hub_id: opts?.hubId ?? 424242,
          scopes: opts?.scopes ?? ["oauth", "crm.objects.deals.write"],
          ...(opts?.omitUser
            ? {}
            : { user: opts?.user ?? "rep@portal.test", user_id: opts?.userId ?? 95142122 }),
        },
      };
    }
    if (call.path.startsWith("/crm/v3/properties/")) {
      if (opts?.propertiesForbidden) {
        return { status: 403, body: { category: "MISSING_SCOPES" } };
      }
      // A label-reconcile PATCH on an existing property (send fields) — echo OK.
      if (call.method === "PATCH") {
        return { status: 200, body: { name: call.path.split("/").pop() } };
      }
      if (call.method !== "POST") {
        return { status: 404, body: {} };
      }
      const key = `${call.path}:${nameOf(call.body)}`;
      if (created.has(key)) return { status: 409, body: { message: "already exists" } };
      created.add(key);
      return { status: 201, body: { name: nameOf(call.body) } };
    }
    return { status: 404, body: {} };
  });
}

/** The HubSpot-DEFINED properties a fresh portal already has (verified live). */
const HUBSPOT_DEFINED: Record<string, string[]> = {
  companies: ["name", "domain", "city", "state"],
  contacts: ["email", "firstname", "lastname", "jobtitle", "hs_linkedin_url"],
  deals: [
    "dealname",
    "pipeline",
    "dealstage",
    "createdate",
    "closedate",
    "hs_v2_date_entered_closedwon",
  ],
};

/** The custom properties `ensureLeadProperties` provisions. */
const CUSTOM_TAG_PROPERTIES = [
  "vertical",
  "signal_source",
  "signal_count",
  "ae_quality",
  "bme_tags",
];

function objectTypeOf(path: string): string | null {
  const m = /\/crm\/v3\/objects\/([^/?]+)/.exec(path);
  return m ? m[1] : null;
}

function propertyObjectTypeOf(path: string): string | null {
  const m = /\/crm\/v3\/properties\/([^/?]+)/.exec(path);
  return m ? m[1] : null;
}

export interface HubSpotApiMockOptions {
  /** Properties returned when a deal is read back. */
  deal?: Record<string, string>;
  /**
   * Simulate a portal where the custom tag properties have NOT been created yet.
   * A write touching them then fails exactly as HubSpot does (400).
   */
  freshPortal?: boolean;
}

/**
 * A HubSpot CRM-object + properties API mock. Create returns sequential ids
 * echoing the sent properties; PATCH echoes the id + properties; GET a deal
 * returns the seeded `deal` properties. Property creation is idempotent (409 on
 * repeat) and object writes validate every property name.
 */
export function hubspotApiMock(opts?: HubSpotApiMockOptions): MockFetch {
  let co = 0;
  let ct = 0;
  let dl = 0;
  const groups = new Set<string>();
  /** email -> contact id, so the mock dedupes contacts exactly as HubSpot does. */
  const contactsByEmail = new Map<string, string>();
  const provisioned: Record<string, Set<string>> = {
    companies: new Set(HUBSPOT_DEFINED.companies),
    contacts: new Set(HUBSPOT_DEFINED.contacts),
    deals: new Set(HUBSPOT_DEFINED.deals),
  };
  if (!opts?.freshPortal) {
    for (const obj of ["companies", "deals"]) {
      for (const p of CUSTOM_TAG_PROPERTIES) provisioned[obj].add(p);
    }
  }

  function unknownProps(objectType: string, body: unknown): string[] {
    const props = propsOf(body);
    if (!props) return [];
    const known = provisioned[objectType] ?? new Set<string>();
    return Object.keys(props).filter((k) => !known.has(k));
  }

  function validationError(missing: string[]): MockResponse {
    return {
      status: 400,
      body: {
        status: "error",
        category: "VALIDATION_ERROR",
        message: `Property values were not valid: ${missing
          .map((n) => `Property "${n}" does not exist`)
          .join(", ")}`,
      },
    };
  }

  return mockFetch((call) => {
    const { method, path, body } = call;

    // ── Property schema routes (must precede object routes: both end in
    //    "/companies") ──────────────────────────────────────────────────────
    if (path.startsWith("/crm/v3/properties/")) {
      const objectType = propertyObjectTypeOf(path);
      if (!objectType) {
        return { status: 404, body: { message: `bad property path ${path}` } };
      }
      if (method === "POST" && path.endsWith("/groups")) {
        const key = `${objectType}:${nameOf(body)}`;
        if (groups.has(key)) {
          return {
            status: 409,
            body: { message: `The Group named '${nameOf(body)}' already exists` },
          };
        }
        groups.add(key);
        return { status: 201, body: { name: nameOf(body) } };
      }
      if (method === "POST") {
        const name = nameOf(body) ?? "";
        const known = provisioned[objectType] ?? new Set<string>();
        if (known.has(name)) {
          return {
            status: 409,
            body: {
              status: "error",
              category: "OBJECT_ALREADY_EXISTS",
              message: `A property named '${name}' already exists.`,
            },
          };
        }
        known.add(name);
        provisioned[objectType] = known;
        return { status: 201, body: { name } };
      }
      return { status: 404, body: { message: `no mock route for ${method} ${path}` } };
    }

    // ── Association routes (v4 default) — idempotent, verified live ─────────
    if (method === "PUT" && /\/crm\/v4\/objects\/.+\/associations\/default\//.test(path)) {
      return { status: 200, body: {} };
    }

    // ── CRM object routes ──────────────────────────────────────────────────
    if (method === "POST" && path.endsWith("/objects/companies")) {
      const bad = unknownProps("companies", body);
      if (bad.length) return validationError(bad);
      return { body: { id: `co_${++co}`, properties: propsOf(body) } };
    }
    // Contact upsert by email — create-or-update, never 409.
    if (method === "POST" && path === "/crm/v3/objects/contacts/batch/upsert") {
      const inputs = (body as { inputs?: Array<{ id: string; properties?: Record<string, string> }> })
        .inputs ?? [];
      const results = inputs.map((input) => {
        const bad = unknownProps("contacts", input);
        if (bad.length) throw new Error(`unknown contact props: ${bad.join(",")}`);
        const existing = contactsByEmail.get(input.id);
        if (existing) return { id: existing, new: false, properties: input.properties };
        const id = `ct_${++ct}`;
        contactsByEmail.set(input.id, id);
        return { id, new: true, properties: input.properties };
      });
      return { body: { results } };
    }
    if (method === "POST" && path.endsWith("/objects/contacts")) {
      const bad = unknownProps("contacts", body);
      if (bad.length) return validationError(bad);
      const email = propsOf(body)?.email;
      // HubSpot dedupes contacts on email: a plain create for an existing address
      // answers 409 CONFLICT. Verified live 2026-07-08.
      if (email && contactsByEmail.has(email)) {
        return {
          status: 409,
          body: {
            category: "CONFLICT",
            message: `Contact already exists. Existing ID: ${contactsByEmail.get(email)}`,
          },
        };
      }
      const id = `ct_${++ct}`;
      if (email) contactsByEmail.set(email, id);
      return { body: { id, properties: propsOf(body) } };
    }
    if (method === "POST" && path.endsWith("/objects/deals")) {
      const bad = unknownProps("deals", body);
      if (bad.length) return validationError(bad);
      return { body: { id: `dl_${++dl}`, properties: propsOf(body) } };
    }
    if (method === "PATCH") {
      const objectType = objectTypeOf(path);
      if (objectType) {
        const bad = unknownProps(objectType, body);
        if (bad.length) return validationError(bad);
      }
      return { body: { id: idFromPath(path), properties: propsOf(body) } };
    }
    if (method === "GET" && path.includes("/objects/deals/")) {
      return { body: { id: idFromPath(path), properties: opts?.deal ?? {} } };
    }
    return { status: 404, body: { message: `no mock route for ${method} ${path}` } };
  });
}
