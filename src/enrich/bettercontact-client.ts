import type { Meter } from "@/src/roi/cost-meter";
import { normalizeBetterContactEmailQuality } from "./email-quality";
import { ProviderBlockedError, type PersonEmailRequest, type PersonEmailResult } from "./types";

export const BETTERCONTACT_ASYNC_URL = "https://app.bettercontact.rocks/api/v2/async";

function rec(v: unknown): Record<string, unknown> | null { return typeof v === "object" && v !== null && !Array.isArray(v) ? v as Record<string, unknown> : null; }
function str(v: unknown): string | null { return typeof v === "string" && v.trim() ? v.trim() : null; }
function pick(o: Record<string, unknown>, keys: string[]): string | null { for (const k of keys) { const v=str(o[k]); if(v) return v; } return null; }
function block(status: number): ProviderBlockedError["reason"] | null { if(status===401||status===403) return "auth"; if(status===402) return "credits"; if(status===429) return "rate_limit"; return null; }

export function normalizeBetterContactEmailResponse(raw: unknown): PersonEmailResult {
  const root = rec(raw) ?? {};
  const data = Array.isArray(root.data) ? rec(root.data[0]) ?? root : rec(root.data) ?? root;
  const email = pick(data, ["contact_email_address", "email", "email_address", "work_email"]);
  const status = pick(data, ["contact_email_address_status", "email_status", "status"]);
  return { email, quality: normalizeBetterContactEmailQuality(status, email), provider: "bettercontact", status, linkedinUrl: pick(data, ["linkedin_url", "contact_linkedin_url"]), raw };
}

export interface BetterContactClientDeps { apiKey: string; fetch?: typeof fetch; meter?: Meter; practiceId?: string | null; }
export function createBetterContactClient(deps: BetterContactClientDeps) {
  const doFetch = deps.fetch ?? fetch;
  return {
    async enrichEmail(request: PersonEmailRequest): Promise<PersonEmailResult> {
      const body = { data: [{ full_name: request.fullName, company: request.companyName, company_domain: request.websiteDomain ?? undefined, linkedin_url: request.linkedinUrl ?? undefined }], enrich_email_address: true, enrich_phone_number: false };
      const call = async () => {
        const res = await doFetch(BETTERCONTACT_ASYNC_URL, { method: "POST", headers: { "Content-Type": "application/json", "X-API-Key": deps.apiKey }, body: JSON.stringify(body) });
        const raw: unknown = await res.json().catch(() => ({}));
        const reason = block(res.status);
        if (reason) throw new ProviderBlockedError("bettercontact", reason, JSON.stringify(raw).slice(0, 300));
        if (!res.ok) throw new ProviderBlockedError("bettercontact", "api_contract", `HTTP ${res.status}`);
        return normalizeBetterContactEmailResponse(raw);
      };
      return deps.meter ? deps.meter({ provider: "bettercontact", operation: "contact.enrich", pipelineStep: "enrich.email", practiceId: deps.practiceId, units: 1, unitCostUsd: 0, meta: (r) => ({ quality: r.quality, status: r.status }) }, call) : call();
    },
  };
}
