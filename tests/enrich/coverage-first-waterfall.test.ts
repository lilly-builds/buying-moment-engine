import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { contacts, practices } from "@/db/schema";
import { resolvePractice } from "@/src/engine/resolver";
import { enrichPractice, type Scraper, type WaterfallDeps } from "@/src/enrich/waterfall";
import type { BetterContactClient, FullEnrichEmailClient, FullEnrichPeopleClient, ProspeoClient } from "@/src/enrich/types";
import { createTestDb, type TestDb } from "../setup";
import roleOnly from "./fixtures/anthropic-research-role-only.json";
import { HARBOR_PAGES } from "./fixtures/held-pages";
import { FakeExtractClient, recordingMeter } from "./doubles";

const NOW = new Date("2026-07-13T12:00:00Z");
const SILENT = () => {};

function scraperWithSocial(): Scraper {
  return async () => ({
    pages: HARBOR_PAGES,
    pagesHeld: HARBOR_PAGES.size,
    totalChars: [...HARBOR_PAGES.values()].join("\n").length,
    socialLinks: {
      linkedinUrl: "https://www.linkedin.com/company/harbor-vision-eye-care",
      facebookUrl: "https://www.facebook.com/harborvision",
      instagramUrl: null,
      sources: {
        linkedin: "https://harborvision.example/",
        facebook: "https://harborvision.example/",
        instagram: null,
      },
    },
  });
}

describe("coverage-first waterfall production path", () => {
  let t: TestDb;
  beforeEach(async () => { t = await createTestDb(); });
  afterEach(async () => { await t.close(); });

  it("uses Prospeo person search, skips FullEnrich people on a strong hit, and enriches email with FullEnrich first", async () => {
    const { practiceId } = await resolvePractice(t.db, {
      name: "Harbor Vision Eye Care",
      geoKey: "portland-or",
    });
    const { meter } = recordingMeter();

    const prospeoCalls: unknown[] = [];
    const fullPeopleCalls: unknown[] = [];
    const fullEmailCalls: unknown[] = [];
    const betterCalls: unknown[] = [];

    const prospeo: ProspeoClient = {
      async searchPerson(request) {
        prospeoCalls.push(request);
        return {
          candidates: [{
            name: "Dana Whitfield",
            role: "Practice Manager",
            linkedinUrl: "linkedin.com/in/dana-whitfield",
            companyDomain: "harborvision.example",
            sourceProvider: "prospeo",
          }],
        };
      },
    };
    const fullenrichPeople: FullEnrichPeopleClient = {
      async searchPeople(request) { fullPeopleCalls.push(request); return { candidates: [] }; },
    };
    const fullenrichEmail: FullEnrichEmailClient = {
      async enrichEmail(request) {
        fullEmailCalls.push(request);
        return { email: "dana@harborvision.example", quality: "safe_work", provider: "fullenrich", status: "DELIVERABLE" };
      },
    };
    const bettercontact: BetterContactClient = {
      async enrichEmail(request) { betterCalls.push(request); return { email: null, quality: "none", provider: "bettercontact" }; },
    };

    const deps: WaterfallDeps = {
      db: t.db,
      scrape: scraperWithSocial(),
      extract: FakeExtractClient.fromFixture(roleOnly),
      prospeo,
      fullenrichPeople,
      fullenrichEmail,
      bettercontact,
      meter,
      now: () => NOW,
      logger: SILENT,
    };

    const result = await enrichPractice(deps, {
      id: practiceId,
      name: "Harbor Vision Eye Care",
      city: "Portland",
      state: "OR",
      websiteUrl: "https://harborvision.example",
    });

    expect(result.status).toBe("enriched");
    expect(result.pdlCalls).toBe(0);
    expect(result.providerCalls).toMatchObject({ prospeo: 1, fullenrichPeople: 0, fullenrichEmail: 1, bettercontact: 0 });
    expect(prospeoCalls).toHaveLength(1);
    expect(fullPeopleCalls).toHaveLength(0);
    expect(fullEmailCalls).toHaveLength(1);
    expect(betterCalls).toHaveLength(0);

    const [contact] = await t.db.select().from(contacts).where(eq(contacts.practiceId, practiceId));
    expect(contact.name).toBe("Dana Whitfield");
    expect(contact.personProvider).toBe("prospeo");
    expect(contact.emailProvider).toBe("fullenrich");
    expect(contact.emailQuality).toBe("safe_work");
    expect(contact.buyerTier).toBe("B");
    expect(contact.selectedContactClassification).toBe("best_buyer");
    expect(contact.linkedinUrl).toBe("https://linkedin.com/in/dana-whitfield");

    const [practice] = await t.db.select().from(practices).where(eq(practices.id, practiceId));
    expect(practice.companyLinkedinUrl).toBe("https://www.linkedin.com/company/harbor-vision-eye-care");
    expect(practice.companyFacebookUrl).toBe("https://www.facebook.com/harborvision");
  });
});
