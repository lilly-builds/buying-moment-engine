import { describe, expect, it } from "vitest";
import { normalizeBetterContactEmailResponse } from "@/src/enrich/bettercontact-client";
import { normalizeFullEnrichEmailResponse, normalizeFullEnrichPeopleResponse } from "@/src/enrich/fullenrich-client";
import { createProspeoClient, normalizeProspeoSearchResponse, prospeoSearchBody } from "@/src/enrich/prospeo-client";

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


describe("Prospeo production client", () => {
  it("uses the filtered search-person request shape that Prospeo accepts", () => {
    expect(prospeoSearchBody({
      companyName: "Texas Orthopedics",
      websiteDomain: "https://www.txortho.com/locations/northwest-austin/",
      targetRoles: ["practice manager", "office manager"],
    })).toEqual({
      page: 1,
      filters: {
        company: { websites: { include: ["txortho.com"] } },
        person_job_title: {
          boolean_search: "('practice manager' OR 'office manager') AND !sales AND !marketing AND !student AND !intern AND !recruiter AND !resident",
        },
        max_person_per_company: 10,
      },
    });
  });

  it("sends that request body to /search-person", async () => {
    let sent: unknown = null;
    const client = createProspeoClient({
      apiKey: "test-key",
      fetch: (async (_url, init) => {
        sent = JSON.parse(String(init?.body));
        return Response.json({ results: [] });
      }) as typeof fetch,
    });

    await client.searchPerson({
      companyName: "Texas Orthopedics",
      websiteDomain: "txortho.com",
      targetRoles: ["practice manager"],
    });

    expect(sent).toMatchObject({
      page: 1,
      filters: {
        company: { websites: { include: ["txortho.com"] } },
        max_person_per_company: 10,
      },
    });
  });
});
