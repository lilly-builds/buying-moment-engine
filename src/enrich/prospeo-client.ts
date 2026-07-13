import type { Meter } from "@/src/roi/cost-meter";
import {
  ProviderBlockedError,
  type PersonSearchRequest,
  type PersonSearchResult,
} from "./types";

export const PROSPEO_PERSON_SEARCH_URL = "https://api.prospeo.io/search-person";

const EXCLUDED_TITLE_TERMS = ["sales", "marketing", "student", "intern", "recruiter", "resident"];

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
function pickString(obj: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = asString(obj[key]);
    if (value) return value;
  }
  return null;
}
function candidatesFrom(raw: unknown): unknown[] {
  const root = asRecord(raw);
  if (!root) return [];
  const direct = root.people ?? root.persons ?? root.results ?? root.data;
  if (Array.isArray(direct)) return direct;
  const nested = asRecord(root.data);
  if (nested) {
    for (const key of ["people", "persons", "results"]) {
      if (Array.isArray(nested[key])) return nested[key];
    }
  }
  return [];
}

function blockReason(status: number): ProviderBlockedError["reason"] | null {
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

function titleBooleanSearch(targetRoles: readonly string[]): string {
  const included = targetRoles
    .map((role) => role.trim())
    .filter(Boolean)
    .map((role) => `'${role.replace(/'/g, "\\'")}'`);
  const excluded = EXCLUDED_TITLE_TERMS.map((term) => `AND !${term}`);
  return `(${included.join(" OR ")}) ${excluded.join(" ")}`.trim();
}

export function prospeoSearchBody(request: PersonSearchRequest): Record<string, unknown> {
  const domain = cleanDomain(request.websiteDomain);
  return {
    page: 1,
    filters: {
      company: domain
        ? { websites: { include: [domain] } }
        : { names: { include: [request.companyName] } },
      person_job_title: { boolean_search: titleBooleanSearch(request.targetRoles) },
      max_person_per_company: 10,
    },
  };
}

export function normalizeProspeoSearchResponse(raw: unknown): PersonSearchResult {
  const root = asRecord(raw);
  const status = asString(root?.status) ?? asString(root?.error) ?? asString(root?.error_code);
  if (status?.toUpperCase() === "NO_RESULTS") return { candidates: [], raw };
  const people = candidatesFrom(raw);
  return {
    candidates: people.flatMap((item) => {
      const rec = asRecord(item);
      if (!rec) return [];
      const person = asRecord(rec.person) ?? rec;
      const company = asRecord(rec.company) ?? asRecord(person.company) ?? {};
      const first = pickString(person, ["first_name", "firstName"]);
      const last = pickString(person, ["last_name", "lastName"]);
      const name =
        pickString(person, ["full_name", "fullName", "name"]) ??
        ([first, last].filter(Boolean).join(" ") || null);
      return [{
        name,
        role: pickString(person, ["current_job_title", "job_title", "title", "position", "headline"]),
        linkedinUrl: pickString(person, ["linkedin_url", "linkedin", "linkedinUrl"]),
        companyName: pickString(company, ["name", "company_name"]) ?? pickString(person, ["company_name", "current_company"]),
        companyDomain: pickString(company, ["domain"]) ?? cleanDomain(pickString(company, ["website"]) ?? pickString(person, ["company_website"])),
        location: pickString(person, ["location", "city", "state"]),
        sourceProvider: "prospeo" as const,
        confidence: typeof rec.confidence === "number" ? rec.confidence : null,
      }];
    }),
    raw,
    credits: typeof root?.credits === "number" ? root.credits : null,
  };
}

export interface ProspeoClientDeps {
  apiKey: string;
  fetch?: typeof fetch;
  meter?: Meter;
  practiceId?: string | null;
}

export function createProspeoClient(deps: ProspeoClientDeps) {
  const doFetch = deps.fetch ?? fetch;
  return {
    async searchPerson(request: PersonSearchRequest): Promise<PersonSearchResult> {
      const body = prospeoSearchBody(request);
      const call = async () => {
        const res = await doFetch(PROSPEO_PERSON_SEARCH_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-KEY": deps.apiKey },
          body: JSON.stringify(body),
        });
        const raw: unknown = await res.json().catch(() => ({}));
        const reason = blockReason(res.status);
        if (reason) {
          throw new ProviderBlockedError("prospeo", reason, JSON.stringify(raw).slice(0, 300));
        }
        if (!res.ok) {
          throw new ProviderBlockedError(
            "prospeo",
            "api_contract",
            `HTTP ${res.status} ${JSON.stringify(raw).slice(0, 300)}`,
          );
        }
        return normalizeProspeoSearchResponse(raw);
      };
      return deps.meter
        ? deps.meter({
            provider: "prospeo",
            operation: "person.search",
            pipelineStep: "enrich.person_discovery",
            practiceId: deps.practiceId,
            units: 1,
            unitCostUsd: 0,
            meta: (r) => ({ candidates: r.candidates.length, credits: r.credits ?? null }),
          }, call)
        : call();
    },
  };
}
