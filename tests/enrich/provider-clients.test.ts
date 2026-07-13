import { describe, expect, it } from "vitest";
import { normalizeBetterContactEmailResponse } from "@/src/enrich/bettercontact-client";
import { normalizeFullEnrichEmailResponse, normalizeFullEnrichPeopleResponse } from "@/src/enrich/fullenrich-client";
import { normalizeProspeoSearchResponse } from "@/src/enrich/prospeo-client";

describe("coverage-first provider normalizers", () => {
  it("normalizes Prospeo NO_RESULTS as a clean miss", () => {
    expect(normalizeProspeoSearchResponse({ status: "NO_RESULTS" }).candidates).toEqual([]);
  });

  it("normalizes Prospeo people into shared candidates", () => {
    const result = normalizeProspeoSearchResponse({ data: [{ full_name: "Dana Whitfield", job_title: "Practice Manager", linkedin_url: "https://linkedin.com/in/dana", company_domain: "practice.example" }] });
    expect(result.candidates[0]).toMatchObject({ name: "Dana Whitfield", role: "Practice Manager", sourceProvider: "prospeo" });
  });

  it("normalizes FullEnrich people into shared candidates", () => {
    const result = normalizeFullEnrichPeopleResponse({ results: [{ name: "Pat Owner", title: "Owner", linkedin: "https://linkedin.com/in/pat" }] });
    expect(result.candidates[0]).toMatchObject({ name: "Pat Owner", role: "Owner", sourceProvider: "fullenrich" });
  });

  it("labels FullEnrich HIGH_PROBABILITY as weak work", () => {
    expect(normalizeFullEnrichEmailResponse({ data: [{ email: "dana@practice.example", status: "HIGH_PROBABILITY" }] }).quality).toBe("weak_work");
  });

  it("labels BetterContact deliverable as safe work", () => {
    expect(normalizeBetterContactEmailResponse({ data: [{ contact_email_address: "dana@practice.example", contact_email_address_status: "deliverable" }] }).quality).toBe("safe_work");
  });
});
