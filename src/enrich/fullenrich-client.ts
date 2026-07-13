import type { Meter } from "@/src/roi/cost-meter";
import { normalizeFullEnrichEmailQuality } from "./email-quality";
import {
  ProviderBlockedError,
  type PersonEmailRequest,
  type PersonEmailResult,
  type PersonSearchRequest,
  type PersonSearchResult,
} from "./types";

export const FULLENRICH_PEOPLE_SEARCH_URL = "https://app.fullenrich.com/api/v2/people/search";
export const FULLENRICH_CONTACT_ENRICH_URL = "https://app.fullenrich.com/api/v2/contact/enrich/bulk";

const FULLENRICH_EMAIL_POLL_ATTEMPTS = 18;
const FULLENRICH_EMAIL_POLL_MS = 5_000;

function rec(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? v as Record<string, unknown> : null;
}
function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}
function pick(o: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = str(o[k]);
    if (v) return v;
  }
  return null;
}
function arr(raw: unknown): unknown[] {
  const r = rec(raw);
  if (!r) return [];
  for (const v of [r.data, r.results, r.people]) {
    if (Array.isArray(v)) return v;
    const n = rec(v);
    if (n) for (const k of ["data", "results", "people"]) if (Array.isArray(n[k])) return n[k] as unknown[];
  }
  return [];
}
function block(status: number): ProviderBlockedError["reason"] | null {
  if (status === 401 || status === 403) return "auth";
  if (status === 402) return "credits";
  if (status === 429) return "rate_limit";
  return null;
}
function cleanDomain(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const withScheme = value.includes("://") ? value : `https://${value}`;
    return new URL(withScheme).hostname.replace(/^www\./, "");
  } catch {
    return value.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0] || null;
  }
}
function splitName(fullName: string): { firstName: string; lastName: string } {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  return { firstName: parts[0] ?? fullName, lastName: parts.slice(1).join(" ") };
}
function noEmpty(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined && value !== null && value !== ""));
}
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
function isDone(raw: unknown): boolean {
  return String(rec(raw)?.status ?? "").toUpperCase() === "FINISHED";
}
function blockedStatus(raw: unknown): string | null {
  const status = String(rec(raw)?.status ?? "").toUpperCase();
  return ["CREDITS_INSUFFICIENT", "FAILED", "ERROR"].includes(status) ? status : null;
}

export function fullEnrichPeopleSearchBody(request: PersonSearchRequest): Record<string, unknown> {
  const domain = cleanDomain(request.websiteDomain);
  return {
    offset: 0,
    limit: 10,
    ...(domain
      ? { current_company_domains: [{ value: domain, exact_match: true, exclude: false }] }
      : { current_company_names: [{ value: request.companyName, exact_match: false, exclude: false }] }),
    current_position_titles: request.targetRoles.map((value) => ({ value, exact_match: false, exclude: false })),
  };
}

export function fullEnrichEmailBody(request: PersonEmailRequest): Record<string, unknown> {
  const { firstName, lastName } = splitName(request.fullName);
  return {
    name: `BME coverage-first ${new Date().toISOString().slice(0, 10)}`,
    data: [
      noEmpty({
        first_name: firstName,
        last_name: lastName,
        domain: cleanDomain(request.websiteDomain) ?? undefined,
        company_name: request.companyName,
        linkedin_url: request.linkedinUrl ?? undefined,
        enrich_fields: ["contact.work_emails"],
      }),
    ],
  };
}

export function normalizeFullEnrichPeopleResponse(raw: unknown): PersonSearchResult {
  return {
    candidates: arr(raw).flatMap((it) => {
      const o = rec(it);
      if (!o) return [];
      const person = rec(o.person) ?? o;
      const employment = rec(person.employment) ? rec(rec(person.employment)?.current) : null;
      const current = employment ?? rec(person.current_employment) ?? rec(o.current_position) ?? {};
      const company = rec(current.company) ?? rec(o.company) ?? rec(person.current_company) ?? {};
      const first = pick(person, ["first_name", "firstName"]);
      const last = pick(person, ["last_name", "lastName"]);
      return [{
        name: pick(person, ["full_name", "fullName", "name"]) ?? ([first, last].filter(Boolean).join(" ") || null),
        role: pick(current, ["title"]) ?? pick(person, ["current_job_title", "job_title", "title", "position"]),
        linkedinUrl: pick(person, ["linkedin_url", "linkedin", "linkedinUrl", "professional_network_url"]),
        companyName: pick(company, ["name"]) ?? pick(person, ["company_name", "current_company_name"]),
        companyDomain: pick(company, ["domain"]) ?? pick(person, ["company_domain", "current_company_domain"]),
        location: pick(person, ["location", "city", "state"]),
        sourceProvider: "fullenrich" as const,
        confidence: typeof o.confidence === "number" ? o.confidence : null,
      }];
    }),
    raw,
  };
}

export function normalizeFullEnrichEmailResponse(raw: unknown): PersonEmailResult {
  const root = rec(raw);
  const rows = arr(raw);
  const row = rec(rows[0]) ?? root ?? {};
  const contactInfo = rec(row.contact_info) ?? row;
  const mostProbable = rec(contactInfo.most_probable_work_email);
  const workEmails = Array.isArray(contactInfo.work_emails) ? contactInfo.work_emails : [];
  const firstWork = rec(workEmails.find((email) => rec(email)?.status === "DELIVERABLE")) ?? rec(workEmails[0]);
  const email =
    pick(mostProbable ?? {}, ["email", "work_email", "email_address"]) ??
    pick(firstWork ?? {}, ["email", "work_email", "email_address"]) ??
    pick(row, ["email", "work_email", "email_address"]);
  const status =
    pick(mostProbable ?? {}, ["status", "email_status", "email_verification_status"]) ??
    pick(firstWork ?? {}, ["status", "email_status", "email_verification_status"]) ??
    pick(row, ["email_status", "status", "email_verification_status"]);
  return {
    email,
    quality: normalizeFullEnrichEmailQuality(status, email),
    provider: "fullenrich",
    status,
    linkedinUrl: pick(row, ["linkedin_url", "linkedin"]),
    raw,
  };
}

export interface FullEnrichClientDeps {
  apiKey: string;
  fetch?: typeof fetch;
  meter?: Meter;
  practiceId?: string | null;
  sleep?: (ms: number) => Promise<void>;
}
export function createFullEnrichClient(deps: FullEnrichClientDeps) {
  const doFetch = deps.fetch ?? fetch;
  const doSleep = deps.sleep ?? sleep;
  async function request(url: string, init: RequestInit): Promise<unknown> {
    const res = await doFetch(url, {
      ...init,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${deps.apiKey}`, ...init.headers },
    });
    const raw: unknown = await res.json().catch(() => ({}));
    const reason = block(res.status);
    if (reason) throw new ProviderBlockedError("fullenrich", reason, JSON.stringify(raw).slice(0, 300));
    if (!res.ok) {
      throw new ProviderBlockedError(
        "fullenrich",
        "api_contract",
        `HTTP ${res.status} ${JSON.stringify(raw).slice(0, 300)}`,
      );
    }
    return raw;
  }
  async function post(url: string, body: unknown): Promise<unknown> {
    return request(url, { method: "POST", body: JSON.stringify(body) });
  }
  async function get(url: string): Promise<unknown> {
    return request(url, { method: "GET" });
  }
  return {
    async searchPeople(request: PersonSearchRequest): Promise<PersonSearchResult> {
      const body = fullEnrichPeopleSearchBody(request);
      const call = async () => normalizeFullEnrichPeopleResponse(await post(FULLENRICH_PEOPLE_SEARCH_URL, body));
      return deps.meter
        ? deps.meter({ provider: "fullenrich", operation: "people.search", pipelineStep: "enrich.person_discovery", practiceId: deps.practiceId, units: 1, unitCostUsd: 0, meta: (r) => ({ candidates: r.candidates.length }) }, call)
        : call();
    },
    async enrichEmail(request: PersonEmailRequest): Promise<PersonEmailResult> {
      const body = fullEnrichEmailBody(request);
      const call = async () => {
        const submit = await post(FULLENRICH_CONTACT_ENRICH_URL, body);
        const submitRecord = rec(submit) ?? {};
        const id = pick(submitRecord, ["id", "enrichment_id", "request_id"]);
        if (!id) return normalizeFullEnrichEmailResponse(submit);
        let latest: unknown = submit;
        for (let i = 0; i < FULLENRICH_EMAIL_POLL_ATTEMPTS; i += 1) {
          if (i > 0) await doSleep(FULLENRICH_EMAIL_POLL_MS);
          latest = await get(`${FULLENRICH_CONTACT_ENRICH_URL}/${encodeURIComponent(id)}`);
          if (isDone(latest)) return normalizeFullEnrichEmailResponse(latest);
          const blocked = blockedStatus(latest);
          if (blocked) {
            const reason = blocked === "CREDITS_INSUFFICIENT" ? "credits" : "api_contract";
            throw new ProviderBlockedError("fullenrich", reason, `${blocked} ${JSON.stringify(latest).slice(0, 300)}`);
          }
        }
        throw new ProviderBlockedError("fullenrich", "api_contract", "bulk email enrichment did not finish before timeout");
      };
      return deps.meter
        ? deps.meter({ provider: "fullenrich", operation: "contact.enrich", pipelineStep: "enrich.email", practiceId: deps.practiceId, units: 1, unitCostUsd: 0, meta: (r) => ({ quality: r.quality, status: r.status }) }, call)
        : call();
    },
  };
}
