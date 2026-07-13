import type { Meter } from "@/src/roi/cost-meter";
import { normalizeFullEnrichEmailQuality } from "./email-quality";
import { ProviderBlockedError, type PersonEmailRequest, type PersonEmailResult, type PersonSearchRequest, type PersonSearchResult } from "./types";

export const FULLENRICH_PEOPLE_SEARCH_URL = "https://app.fullenrich.com/api/v2/people/search";
export const FULLENRICH_CONTACT_ENRICH_URL = "https://app.fullenrich.com/api/v2/contact/enrich/bulk";

function rec(v: unknown): Record<string, unknown> | null { return typeof v === "object" && v !== null && !Array.isArray(v) ? v as Record<string, unknown> : null; }
function str(v: unknown): string | null { return typeof v === "string" && v.trim() ? v.trim() : null; }
function pick(o: Record<string, unknown>, keys: string[]): string | null { for (const k of keys) { const v=str(o[k]); if(v) return v; } return null; }
function arr(raw: unknown): unknown[] { const r=rec(raw); if(!r) return []; for(const v of [r.data, r.results, r.people]) { if(Array.isArray(v)) return v; const n=rec(v); if(n) for(const k of ["data","results","people"]) if(Array.isArray(n[k])) return n[k] as unknown[]; } return []; }
function block(status: number): ProviderBlockedError["reason"] | null { if(status===401||status===403) return "auth"; if(status===402) return "credits"; if(status===429) return "rate_limit"; return null; }

export function normalizeFullEnrichPeopleResponse(raw: unknown): PersonSearchResult {
  return { candidates: arr(raw).flatMap((it) => { const o=rec(it); if(!o) return []; const first=pick(o,["first_name","firstName"]); const last=pick(o,["last_name","lastName"]); return [{ name: pick(o,["full_name","fullName","name"]) ?? ([first,last].filter(Boolean).join(" ") || null), role: pick(o,["title","job_title","position"]), linkedinUrl: pick(o,["linkedin_url","linkedin","linkedinUrl"]), companyName: pick(o,["company_name","company","current_company"]), companyDomain: pick(o,["company_domain","domain"]), location: pick(o,["location","city","state"]), sourceProvider: "fullenrich" as const, confidence: typeof o.confidence === "number" ? o.confidence : null }]; }), raw };
}

export function normalizeFullEnrichEmailResponse(raw: unknown): PersonEmailResult {
  const root=rec(raw); const rows=arr(raw); const row=rec(rows[0]) ?? root ?? {}; const email=pick(row,["email","work_email","email_address"]); const status=pick(row,["email_status","status","email_verification_status"]); return { email, quality: normalizeFullEnrichEmailQuality(status, email), provider: "fullenrich", status, linkedinUrl: pick(row,["linkedin_url","linkedin"]), raw };
}

export interface FullEnrichClientDeps { apiKey: string; fetch?: typeof fetch; meter?: Meter; practiceId?: string | null; }
export function createFullEnrichClient(deps: FullEnrichClientDeps) {
  const doFetch=deps.fetch ?? fetch;
  async function post(url: string, body: unknown): Promise<unknown> {
    const res=await doFetch(url,{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${deps.apiKey}`},body:JSON.stringify(body)}); const raw=await res.json().catch(()=>({})); const reason=block(res.status); if(reason) throw new ProviderBlockedError("fullenrich",reason,JSON.stringify(raw).slice(0,300)); if(!res.ok) throw new ProviderBlockedError("fullenrich","api_contract",`HTTP ${res.status}`); return raw;
  }
  return {
    async searchPeople(request: PersonSearchRequest): Promise<PersonSearchResult> { const body={ current_company_domains: request.websiteDomain ? [request.websiteDomain] : undefined, current_company_names: [request.companyName], current_position_titles: request.targetRoles }; const call=async()=>normalizeFullEnrichPeopleResponse(await post(FULLENRICH_PEOPLE_SEARCH_URL, body)); return deps.meter ? deps.meter({provider:"fullenrich",operation:"people.search",pipelineStep:"enrich.person_discovery",practiceId:deps.practiceId,units:1,unitCostUsd:0,meta:(r)=>({candidates:r.candidates.length})},call) : call(); },
    async enrichEmail(request: PersonEmailRequest): Promise<PersonEmailResult> { const body={ data:[{ firstname: request.fullName.split(/\s+/)[0], lastname: request.fullName.split(/\s+/).slice(1).join(" "), fullname: request.fullName, company_name: request.companyName, company_domain: request.websiteDomain ?? undefined, linkedin_url: request.linkedinUrl ?? undefined, enrich_fields:["email"] }] }; const call=async()=>normalizeFullEnrichEmailResponse(await post(FULLENRICH_CONTACT_ENRICH_URL, body)); return deps.meter ? deps.meter({provider:"fullenrich",operation:"contact.enrich",pipelineStep:"enrich.email",practiceId:deps.practiceId,units:1,unitCostUsd:0,meta:(r)=>({quality:r.quality,status:r.status})},call) : call(); },
  };
}
