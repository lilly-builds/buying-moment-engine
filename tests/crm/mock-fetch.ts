/**
 * Test helper: a programmable `fetch` mock for the HubSpot REST + OAuth token
 * endpoints. No live account is touched — the adapter/flows run against these
 * recorded shapes (U10), and the live swap happens in U15.
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

function idFromPath(path: string): string {
  return path.split("/").filter(Boolean).pop() ?? "";
}

/**
 * A HubSpot CRM-object API mock: create returns sequential ids echoing the sent
 * properties; PATCH echoes the id + properties; GET a deal returns the seeded
 * `deal` properties. Every request is recorded for assertions.
 */
export function hubspotApiMock(opts?: {
  deal?: Record<string, string>;
}): MockFetch {
  let co = 0;
  let ct = 0;
  let dl = 0;
  return mockFetch((call) => {
    const { method, path, body } = call;
    if (method === "POST" && path.endsWith("/companies")) {
      return { body: { id: `co_${++co}`, properties: propsOf(body) } };
    }
    if (method === "POST" && path.endsWith("/contacts")) {
      return { body: { id: `ct_${++ct}`, properties: propsOf(body) } };
    }
    if (method === "POST" && path.endsWith("/deals")) {
      return { body: { id: `dl_${++dl}`, properties: propsOf(body) } };
    }
    if (method === "PATCH") {
      return { body: { id: idFromPath(path), properties: propsOf(body) } };
    }
    if (method === "GET" && path.includes("/deals/")) {
      return { body: { id: idFromPath(path), properties: opts?.deal ?? {} } };
    }
    return { status: 404, body: { message: `no mock route for ${method} ${path}` } };
  });
}
