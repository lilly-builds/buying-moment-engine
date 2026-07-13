import { describe, expect, it } from "vitest";
import { normalizeBetterContactEmailResponse } from "@/src/enrich/bettercontact-client";
import { createFullEnrichClient, fullEnrichEmailBody, fullEnrichPeopleSearchBody, normalizeFullEnrichEmailResponse, normalizeFullEnrichPeopleResponse } from "@/src/enrich/fullenrich-client";
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


  it("treats Prospeo HTTP 400 NO_RESULTS as a clean miss so fallback providers can run", async () => {
    const client = createProspeoClient({
      apiKey: "test-key",
      fetch: (async () => Response.json(
        { error: true, error_code: "NO_RESULTS" },
        { status: 400 },
      )) as typeof fetch,
    });

    await expect(client.searchPerson({
      companyName: "No Match Practice",
      websiteDomain: "nomatch.example",
      targetRoles: ["practice manager"],
    })).resolves.toMatchObject({ candidates: [] });
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


describe("FullEnrich production client", () => {
  it("uses object filters for people search", () => {
    expect(fullEnrichPeopleSearchBody({
      companyName: "Texas Orthopedics",
      websiteDomain: "https://www.txortho.com/path",
      targetRoles: ["practice manager"],
    })).toMatchObject({
      offset: 0,
      limit: 10,
      current_company_domains: [{ value: "txortho.com", exact_match: true, exclude: false }],
      current_position_titles: [{ value: "practice manager", exact_match: false, exclude: false }],
    });
  });

  it("uses the accepted bulk email enrichment fields", () => {
    expect(fullEnrichEmailBody({
      fullName: "Jennifer Hadley",
      companyName: "Texas Orthopedics",
      websiteDomain: "txortho.com",
      linkedinUrl: "https://linkedin.com/in/jennifer",
    })).toMatchObject({
      data: [{
        first_name: "Jennifer",
        last_name: "Hadley",
        domain: "txortho.com",
        company_name: "Texas Orthopedics",
        linkedin_url: "https://linkedin.com/in/jennifer",
        enrich_fields: ["contact.work_emails"],
      }],
    });
  });

  it("polls bulk email enrichment and normalizes the finished row", async () => {
    const calls: string[] = [];
    const client = createFullEnrichClient({
      apiKey: "test-key",
      sleep: async () => {},
      fetch: (async (url, init) => {
        calls.push(`${init?.method ?? "GET"} ${url}`);
        if (init?.method === "POST") return Response.json({ id: "bulk-1", status: "PENDING" });
        return Response.json({
          status: "FINISHED",
          data: [{
            contact_info: {
              most_probable_work_email: {
                email: "jennifer@txortho.com",
                status: "DELIVERABLE",
              },
            },
          }],
        });
      }) as typeof fetch,
    });

    const result = await client.enrichEmail({
      fullName: "Jennifer Hadley",
      companyName: "Texas Orthopedics",
      websiteDomain: "txortho.com",
    });

    expect(calls).toEqual([
      "POST https://app.fullenrich.com/api/v2/contact/enrich/bulk",
      "GET https://app.fullenrich.com/api/v2/contact/enrich/bulk/bulk-1",
    ]);
    expect(result).toMatchObject({
      email: "jennifer@txortho.com",
      quality: "safe_work",
      status: "DELIVERABLE",
    });
  });
});
