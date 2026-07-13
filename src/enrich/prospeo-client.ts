import type { Meter } from "@/src/roi/cost-meter";
import { ProviderBlockedError, type PersonSearchRequest, type PersonSearchResult } from "./types";

export const PROSPEO_PERSON_SEARCH_URL = "https://api.prospeo.io/search-person";

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
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

export function normalizeProspeoSearchResponse(raw: unknown): PersonSearchResult {
  const root = asRecord(raw);
  const status = asString(root?.status) ?? asString(root?.error);
  if (status?.toUpperCase() === "NO_RESULTS") return { candidates: [], raw };
  const people = candidatesFrom(raw);
  return {
    candidates: people.flatMap((item) => {
      const rec = asRecord(item);
      if (!rec) return [];
      const first = pickString(rec, ["first_name", "firstName"]);
      const last = pickString(rec, ["last_name", "lastName"]);
      const name = pickString(rec, ["full_name", "fullName", "name"]) ?? ([first, last].filter(Boolean).join(" ") || null);
      return [{
        name,
        role: pickString(rec, ["job_title", "title", "position"]),
        linkedinUrl: pickString(rec, ["linkedin_url", "linkedin", "linkedinUrl"]),
        companyName: pickString(rec, ["company", "company_name", "current_company"]),
        companyDomain: pickString(rec, ["company_domain", "domain"]),
        location: pickString(rec, ["location", "city", "state"]),
        sourceProvider: "prospeo" as const,
        confidence: typeof rec.confidence === "number" ? rec.confidence : null,
      }];
    }),
    raw,
    credits: typeof root?.credits === "number" ? root.credits : null,
  };
}

export interface ProspeoClientDeps { apiKey: string; fetch?: typeof fetch; meter?: Meter; practiceId?: string | null; }

export function createProspeoClient(deps: ProspeoClientDeps) {
  const doFetch = deps.fetch ?? fetch;
  return {
    async searchPerson(request: PersonSearchRequest): Promise<PersonSearchResult> {
      const body = {
        company: request.companyName,
        company_domain: request.websiteDomain ?? undefined,
        location: [request.city, request.state].filter(Boolean).join(", ") || undefined,
        job_titles: request.targetRoles,
        enrich_mobile: false,
      };
      const call = async () => {
        const res = await doFetch(PROSPEO_PERSON_SEARCH_URL, { method: "POST", headers: { "Content-Type": "application/json", "X-KEY": deps.apiKey }, body: JSON.stringify(body) });
        const raw: unknown = await res.json().catch(() => ({}));
        const reason = blockReason(res.status);
        if (reason) throw new ProviderBlockedError("prospeo", reason, JSON.stringify(raw).slice(0, 300));
        if (!res.ok) throw new ProviderBlockedError("prospeo", "api_contract", `HTTP ${res.status}`);
        return normalizeProspeoSearchResponse(raw);
      };
      return deps.meter ? deps.meter({ provider: "prospeo", operation: "person.search", pipelineStep: "enrich.person_discovery", practiceId: deps.practiceId, units: 1, unitCostUsd: 0, meta: (r) => ({ candidates: r.candidates.length, credits: r.credits ?? null }) }, call) : call();
    },
  };
}
