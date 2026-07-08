import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../setup";
import fullyResolved from "./fixtures/anthropic-research-fully-resolved.json";
import researchFixture from "./fixtures/anthropic-research-response.json";
import roleOnly from "./fixtures/anthropic-research-role-only.json";
import personMatch from "./fixtures/pdl-person-enrich-match.json";
import personNotFound from "./fixtures/pdl-person-enrich-404.json";
import {
  HARBOR_PAGES,
  METRO_PAGES,
  SUNSHINE_PAGES,
  SUNSHINE_PAGES_ROLE_DRIFTED,
} from "./fixtures/held-pages";
import {
  emptyScraper,
  FakeExtractClient,
  FakePdlClient,
  FakeResearchClient,
  fakeScraper,
  recordingMeter,
} from "./doubles";
import { parseMessagesResponse } from "@/src/enrich/anthropic-client";
import { createEscalationBudget, noEscalationBudget } from "@/src/enrich/escalation";
import { drizzleCostRecorder } from "@/db/cost-recorder";
import { contacts, costEvents, evidence, practiceFacts, practices } from "@/db/schema";
import { upsertContact, upsertPracticeFact } from "@/db/enrich";
import { resolvePractice } from "@/src/engine/resolver";
import { enrichPractice, type WaterfallDeps } from "@/src/enrich/waterfall";
import { AnthropicRequestError, PdlRateLimitError } from "@/src/enrich/types";
import { createMeter } from "@/src/roi/cost-meter";

/**
 * FULL-SEAM INTEGRATION (U5's Definition of Done): scrape -> extract -> VERIFY ->
 * gap-fill -> enriched row persisted, on ephemeral PGlite with the externals mocked
 * via recorded fixtures. Nothing here reaches the network; nothing sends (D9).
 *
 * The fake scraper holds `fixtures/held-pages.ts`, and every fixture snippet appears
 * verbatim on the page it cites — because otherwise `verifyFindings` drops it and the
 * test fails. Before this refactor a fixture could cite a URL and quote anything at
 * all, since nothing held the page. The verifier now grades our test data too.
 */

const NOW = new Date("2026-07-08T12:00:00Z");
const SILENT = () => {};

const SUNSHINE = {
  name: "Sunshine Dermatology Associates",
  geoKey: "miami-fl",
  websiteUrl: "https://sunshinederm.example",
};

describe("enrichment waterfall (integration)", () => {
  let t: TestDb;
  beforeEach(async () => {
    t = await createTestDb();
  });
  afterEach(async () => {
    await t.close();
  });

  async function seedPractice(name: string, geoKey: string) {
    const { practiceId } = await resolvePractice(t.db, { name, geoKey });
    return practiceId;
  }

  function deps(
    pages: Map<string, string>,
    extract: FakeExtractClient,
    pdl: FakePdlClient,
  ): { deps: WaterfallDeps; rows: ReturnType<typeof recordingMeter>["rows"] } {
    const { meter, rows } = recordingMeter();
    return {
      deps: {
        db: t.db,
        scrape: fakeScraper(pages).scrape,
        extract,
        pdl,
        meter,
        now: () => NOW,
        logger: SILENT,
      },
      rows,
    };
  }

  it("SCENARIO 3: PDL fills the verified email + LinkedIn gap and persists them", async () => {
    const practiceId = await seedPractice(SUNSHINE.name, SUNSHINE.geoKey);
    const pdl = FakePdlClient.fromFixture(personMatch);
    const { deps: d } = deps(SUNSHINE_PAGES, FakeExtractClient.fromFixture(researchFixture), pdl);

    const result = await enrichPractice(d, {
      id: practiceId,
      name: SUNSHINE.name,
      city: "Miami",
      state: "FL",
      websiteUrl: SUNSHINE.websiteUrl,
    });

    expect(result.status).toBe("enriched");
    expect(result.pdlCalls).toBe(1);
    expect(result.contactVariant).toBe("named");
    // Every fact the extractor produced is provable on a page we held.
    expect(result.factsDropped).toBe(0);
    expect(result.pagesHeld).toBe(5);
    expect(result.escalationTrigger).toBeNull();

    const [contact] = await t.db
      .select()
      .from(contacts)
      .where(eq(contacts.practiceId, practiceId));
    expect(contact.name).toBe("Dana Whitfield");
    expect(contact.role).toBe("Practice Administrator");
    expect(contact.email).toBe("dana.whitfield@sunshinederm.example");
    expect(contact.emailProvider).toBe("pdl");
    // PDL hands back `linkedin.com/in/...` with no scheme. Persisted verbatim, U9's
    // `href` would resolve as a relative path — a dead link. Normalized at persist.
    expect(contact.linkedinUrl).toBe(
      "https://linkedin.com/in/dana-whitfield-example",
    );
    expect(contact.linkedinProvider).toBe("pdl");
    // The page Claude cited for name/role survives alongside PDL's fill.
    expect(contact.sourceUrl).toBe("https://sunshinederm.example/team");
  });

  it("SCENARIO 4 (COST GUARD): a fully-Claude-resolved practice makes ZERO PDL calls", async () => {
    const practiceId = await seedPractice("Metro Ortho Group", "denver-co");
    const pdl = FakePdlClient.fromFixture(personMatch);
    const { deps: d, rows } = deps(METRO_PAGES, FakeExtractClient.fromFixture(fullyResolved), pdl);

    const result = await enrichPractice(d, {
      id: practiceId,
      name: "Metro Ortho Group",
      websiteUrl: "https://metroortho.example",
    });

    expect(result.pdlCalls).toBe(0);
    // Network spy: the PDL client was never touched.
    expect(pdl.personCalls).toEqual([]);
    expect(pdl.companyCalls).toBe(0);
    // And no PDL money was metered.
    expect(rows.filter((r) => r.provider === "pdl")).toHaveLength(0);
    expect(rows.filter((r) => r.provider === "anthropic")).toHaveLength(1);

    const [contact] = await t.db
      .select()
      .from(contacts)
      .where(eq(contacts.practiceId, practiceId));
    expect(contact.email).toBe("marcus.iyer@metroortho.example");
    expect(contact.emailProvider).toBe("claude_research");
    expect(contact.linkedinProvider).toBe("claude_research");
  });

  it("SCENARIO 5: no findable contact degrades to the role-only variant, never fails", async () => {
    const practiceId = await seedPractice("Harbor Vision Eye Care", "portland-or");
    const pdl = FakePdlClient.fromFixture(personMatch);
    const { deps: d } = deps(HARBOR_PAGES, FakeExtractClient.fromFixture(roleOnly), pdl);

    const result = await enrichPractice(d, {
      id: practiceId,
      name: "Harbor Vision Eye Care",
      websiteUrl: "https://harborvision.example",
    });

    expect(result.status).toBe("enriched");
    expect(result.contactVariant).toBe("role_only");
    expect(result.pdlCalls).toBe(0);
    expect(pdl.personCalls).toEqual([]);
    // The specialty fact cites `https://harborvision.example/` while the page map is
    // keyed without the slash. The URL is an identifier we handed the model; tolerating
    // that one difference is what keeps a TRUE fact from being dropped as fabrication.
    expect(result.factsDropped).toBe(0);

    const [contact] = await t.db
      .select()
      .from(contacts)
      .where(eq(contacts.practiceId, practiceId));
    expect(contact.name).toBeNull();
    expect(contact.role).toBe("Office Manager");
    expect(contact.email).toBeNull();
  });

  it("SCENARIO 8: every enrichment call writes a metered cost_events row", async () => {
    const practiceId = await seedPractice(SUNSHINE.name, SUNSHINE.geoKey);
    const meter = createMeter(drizzleCostRecorder(t.db));
    await enrichPractice(
      {
        db: t.db,
        scrape: fakeScraper(SUNSHINE_PAGES).scrape,
        extract: FakeExtractClient.fromFixture(researchFixture),
        pdl: FakePdlClient.fromFixture(personMatch),
        meter,
        now: () => NOW,
        logger: SILENT,
      },
      { id: practiceId, name: SUNSHINE.name, websiteUrl: SUNSHINE.websiteUrl },
    );

    const rows = await t.db
      .select()
      .from(costEvents)
      .where(eq(costEvents.practiceId, practiceId));
    expect(rows).toHaveLength(2);

    const anthropic = rows.find((r) => r.provider === "anthropic")!;
    expect(anthropic.operation).toBe("messages.create");
    // The primary path bills to its own pipeline step, so U12 can price it against the
    // escalation it replaced, on the same practice.
    expect(anthropic.pipelineStep).toBe("enrich.extract");
    expect(Number(anthropic.costUsd)).toBeGreaterThan(0);

    const pdlRow = rows.find((r) => r.provider === "pdl")!;
    expect(pdlRow.operation).toBe("person.enrich");
    expect(Number(pdlRow.units)).toBe(1);
    expect(Number(pdlRow.costUsd)).toBeCloseTo(0.28, 10);
  });

  it("persists every fact with an evidence row carrying source URL + snippet + detected_at", async () => {
    const practiceId = await seedPractice(SUNSHINE.name, SUNSHINE.geoKey);
    const { deps: d } = deps(
      SUNSHINE_PAGES,
      FakeExtractClient.fromFixture(researchFixture),
      FakePdlClient.fromFixture(personNotFound),
    );

    const result = await enrichPractice(d, {
      id: practiceId,
      name: SUNSHINE.name,
      websiteUrl: SUNSHINE.websiteUrl,
    });
    expect(result.factsWritten).toBe(5);

    const facts = await t.db
      .select({
        field: practiceFacts.field,
        value: practiceFacts.value,
        provider: practiceFacts.provider,
        sourceUrl: evidence.sourceUrl,
        snippet: evidence.snippet,
        detectedAt: evidence.detectedAt,
      })
      .from(practiceFacts)
      .innerJoin(evidence, eq(practiceFacts.evidenceId, evidence.id))
      .where(eq(practiceFacts.practiceId, practiceId));

    expect(facts).toHaveLength(5);
    for (const fact of facts) {
      expect(fact.provider).toBe("claude_research");
      expect(fact.sourceUrl).toMatch(/^https:\/\//);
      expect(fact.snippet).toBeTruthy();
      expect(fact.detectedAt).toEqual(NOW);
      // The persisted snippet is verbatim on the page we held. That is D2, at the DB.
      expect(SUNSHINE_PAGES.get(fact.sourceUrl)).toContain(fact.snippet);
    }
    expect(facts.find((f) => f.field === "ehr")?.value).toBe("ModMed EMA");
  });

  it("tags the vertical from the practice's own words", async () => {
    const practiceId = await seedPractice("Metro Ortho Group", "denver-co");
    const { deps: d } = deps(
      METRO_PAGES,
      FakeExtractClient.fromFixture(fullyResolved),
      FakePdlClient.fromFixture(personNotFound),
    );

    const result = await enrichPractice(d, {
      id: practiceId,
      name: "Metro Ortho Group",
      websiteUrl: "https://metroortho.example",
    });
    expect(result.vertical).toBe("orthopedics");

    const [row] = await t.db
      .select()
      .from(practices)
      .where(eq(practices.id, practiceId));
    expect(row.vertical).toBe("orthopedics");
    expect(row.enrichmentStatus).toBe("enriched");
  });

  // ─── D2, the tests that were previously IMPOSSIBLE ─────────────────────────

  it("D2: a FABRICATED snippet never reaches practice_facts, and the drop is reported", async () => {
    // Under the agentic mechanism this fact shipped: a real sourceUrl, a plausible
    // snippet, and no way on earth to check it — we never held the page. Every other
    // fact in the fixture is genuine, so the practice still enriches; only the lie is
    // dropped. That is the difference between a verifier and a kill switch.
    const practiceId = await seedPractice(SUNSHINE.name, SUNSHINE.geoKey);
    const base = parseMessagesResponse(researchFixture);
    const fabricated = new FakeExtractClient(async () => ({
      ...base,
      text: base.text.replace(
        "Our patient portal is powered by ModMed EMA.",
        "The practice migrated to Epic in 2023 and reports a 4-provider team.",
      ),
    }));

    const drops: Record<string, unknown>[] = [];
    const result = await enrichPractice(
      {
        db: t.db,
        scrape: fakeScraper(SUNSHINE_PAGES).scrape,
        extract: fabricated,
        pdl: FakePdlClient.fromFixture(personNotFound),
        meter: recordingMeter().meter,
        now: () => NOW,
        logger: (event, meta) => {
          if (event === "enrich.citation_drops" && meta) drops.push(meta);
        },
      },
      { id: practiceId, name: SUNSHINE.name, websiteUrl: SUNSHINE.websiteUrl },
    );

    expect(result.status).toBe("enriched");
    expect(result.factsDropped).toBe(1);
    expect(result.factsWritten).toBe(4); // was 5

    const fields = (await t.db.select().from(practiceFacts)).map((f) => f.field);
    expect(fields).not.toContain("ehr");
    expect(fields.sort()).toEqual([
      "buying_moment_1",
      "incumbent_tooling_1",
      "specialty",
      "website",
    ]);

    // Loud, not silent: the drop is logged with its field, reason and snippet.
    expect(drops).toHaveLength(1);
    expect(drops[0]).toMatchObject({ practice: SUNSHINE.name, dropped: 1 });
    expect(drops[0].facts).toMatchObject([
      { field: "ehr", reason: "snippet-not-verbatim" },
    ]);
  });

  it("D2: a fabricated VALUE on a genuine snippet never reaches practice_facts", async () => {
    // R1, end to end. The `ehr` snippet is left exactly as it is — verbatim on the page
    // we hold — and only the VALUE is swapped to a competing product. Everything the old
    // verifier looked at still checks out. The brief would have printed "EHR: Epic" and
    // linked a page reading "powered by ModMed EMA", and `waterfall.ts` would have fed
    // that string to `classifyVertical`.
    const practiceId = await seedPractice(SUNSHINE.name, SUNSHINE.geoKey);
    const base = parseMessagesResponse(researchFixture);
    const fabricated = new FakeExtractClient(async () => ({
      ...base,
      text: base.text.replace('"value": "ModMed EMA"', '"value": "Epic"'),
    }));

    const drops: Record<string, unknown>[] = [];
    const result = await enrichPractice(
      {
        db: t.db,
        scrape: fakeScraper(SUNSHINE_PAGES).scrape,
        extract: fabricated,
        pdl: FakePdlClient.fromFixture(personNotFound),
        meter: recordingMeter().meter,
        now: () => NOW,
        logger: (event, meta) => {
          if (event === "enrich.citation_drops" && meta) drops.push(meta);
        },
      },
      { id: practiceId, name: SUNSHINE.name, websiteUrl: SUNSHINE.websiteUrl },
    );

    expect(result.status).toBe("enriched");
    expect(result.factsDropped).toBe(1);
    expect(result.factsWritten).toBe(4); // was 5

    const rows = await t.db.select().from(practiceFacts);
    expect(rows.map((f) => f.field)).not.toContain("ehr");
    expect(rows.map((f) => f.value)).not.toContain("Epic");

    // The drop names the VALUE, not just the snippet — the snippet here is innocent.
    expect(drops[0].facts).toMatchObject([
      { field: "ehr", reason: "value-not-in-snippet", value: "Epic" },
    ]);
  });

  it("D2: a decision-maker whose ROLE is fabricated persists NO contact at all", async () => {
    const practiceId = await seedPractice(SUNSHINE.name, SUNSHINE.geoKey);
    const base = parseMessagesResponse(researchFixture);
    const fabricated = new FakeExtractClient(async () => ({
      ...base,
      text: base.text.replaceAll(
        '"snippet": "Dana Whitfield, Practice Administrator"',
        '"snippet": "Dana Whitfield runs the front office as Practice Administrator"',
      ),
    }));
    const pdl = FakePdlClient.fromFixture(personMatch);

    const result = await enrichPractice(
      {
        db: t.db,
        scrape: fakeScraper(SUNSHINE_PAGES).scrape,
        extract: fabricated,
        pdl,
        meter: recordingMeter().meter,
        now: () => NOW,
        logger: SILENT,
      },
      { id: practiceId, name: SUNSHINE.name, websiteUrl: SUNSHINE.websiteUrl },
    );

    // Who to contact is the one thing a brief must not guess.
    expect(result.contactVariant).toBe("none");
    expect(await t.db.select().from(contacts)).toHaveLength(0);
    // And we did not pay PDL to look up a person we cannot cite.
    expect(pdl.personCalls).toEqual([]);
    expect(result.pdlCalls).toBe(0);
  });

  // ─── Failure paths and the (free) escalation signal ────────────────────────

  it("EDGE CASE: a scrape that yields no text is `failed` and flags a thin-scrape trigger", async () => {
    const practiceId = await seedPractice("Silent Practice", "reno-nv");
    const extract = FakeExtractClient.fromFixture(researchFixture);
    const { meter, rows } = recordingMeter();

    const result = await enrichPractice(
      {
        db: t.db,
        scrape: emptyScraper("blocked").scrape,
        extract,
        pdl: FakePdlClient.fromFixture(personMatch),
        meter,
        now: () => NOW,
        logger: SILENT,
      },
      { id: practiceId, name: "Silent Practice", websiteUrl: "https://silent.example" },
    );

    expect(result.status).toBe("failed");
    expect(result.reason).toMatch(/blocked/);
    expect(result.escalationTrigger).toBe("thin-scrape");
    expect(result.escalated).toBe(false); // U7 wires the escalator; nothing is bought here
    // Nothing was paid for: the extractor was never called.
    expect(extract.calls).toEqual([]);
    expect(rows).toEqual([]);

    const [row] = await t.db.select().from(practices).where(eq(practices.id, practiceId));
    expect(row.enrichmentStatus).toBe("failed");
  });

  it("EDGE CASE: a practice with no website is a thin scrape — nothing to read, nothing paid", async () => {
    const practiceId = await seedPractice("No Site Clinic", "boise-id");
    const { meter, rows } = recordingMeter();
    const scraper = fakeScraper(SUNSHINE_PAGES);

    const result = await enrichPractice(
      {
        db: t.db,
        scrape: scraper.scrape,
        extract: FakeExtractClient.fromFixture(researchFixture),
        pdl: FakePdlClient.fromFixture(personMatch),
        meter,
        now: () => NOW,
        logger: SILENT,
      },
      { id: practiceId, name: "No Site Clinic", websiteUrl: null },
    );

    expect(result.status).toBe("failed");
    expect(result.reason).toBe("no website url");
    expect(result.escalationTrigger).toBe("thin-scrape");
    expect(scraper.calls).toEqual([]);
    expect(rows).toEqual([]);
  });

  it("ERROR PATH: a malformed (but BILLED) extract body fails the practice and is still metered", async () => {
    const practiceId = await seedPractice("Broken Derm", "austin-tx");
    const pdl = FakePdlClient.fromFixture(personMatch);
    const { deps: d, rows } = deps(SUNSHINE_PAGES, FakeExtractClient.malformed(), pdl);

    const result = await enrichPractice(d, {
      id: practiceId,
      name: "Broken Derm",
      websiteUrl: SUNSHINE.websiteUrl,
    });

    expect(result.status).toBe("failed");
    expect(result.reason).toMatch(/malformed JSON/);
    expect(result.escalationTrigger).toBe("extract-failed");
    expect(pdl.personCalls).toEqual([]);
    // Anthropic charged for this. It is metered.
    expect(rows).toHaveLength(1);

    expect(await t.db.select().from(practiceFacts)).toHaveLength(0);
    expect(await t.db.select().from(contacts)).toHaveLength(0);
    const [row] = await t.db.select().from(practices).where(eq(practices.id, practiceId));
    expect(row.enrichmentStatus).toBe("failed");
  });

  it("KTD-7: a THROWN extract call fails the practice but does NOT trigger escalation", async () => {
    // A 429 is unbilled and says nothing about the practice. Answering it by spending
    // $1.27 on the agentic path would be Optiflow's Gate-4 bug, running the other way.
    const practiceId = await seedPractice("Rate Limited Derm", "tampa-fl");
    const { deps: d, rows } = deps(
      SUNSHINE_PAGES,
      FakeExtractClient.throwing(new AnthropicRequestError(429, "rate limited")),
      FakePdlClient.fromFixture(personMatch),
    );

    const result = await enrichPractice(d, {
      id: practiceId,
      name: "Rate Limited Derm",
      websiteUrl: SUNSHINE.websiteUrl,
    });

    expect(result.status).toBe("failed");
    expect(result.reason).toMatch(/429/);
    expect(result.escalationTrigger).toBeNull();
    // Unbilled: the meter recorded nothing.
    expect(rows).toEqual([]);
  });

  it("EDGE CASE: findings whose every fact is fabricated -> no-verified-facts, no partial write", async () => {
    const practiceId = await seedPractice("Fabulist Derm", "miami-fl");
    const base = parseMessagesResponse(researchFixture);
    const allFake = new FakeExtractClient(async () => ({
      ...base,
      text: base.text.replaceAll(
        /"snippet": "[^"]*"/g,
        '"snippet": "Nothing on any page says this."',
      ),
    }));
    const { meter, rows } = recordingMeter();

    const result = await enrichPractice(
      {
        db: t.db,
        scrape: fakeScraper(SUNSHINE_PAGES).scrape,
        extract: allFake,
        pdl: FakePdlClient.fromFixture(personMatch),
        meter,
        now: () => NOW,
        logger: SILENT,
      },
      { id: practiceId, name: "Fabulist Derm", websiteUrl: SUNSHINE.websiteUrl },
    );

    expect(result.status).toBe("failed");
    expect(result.reason).toMatch(/no verified facts/);
    // Extraction SUCCEEDED and nothing threw. The old mechanism could not tell this
    // apart from a good result — this is exactly the case U7 escalates on.
    expect(result.escalationTrigger).toBe("no-verified-facts");
    expect(result.factsDropped).toBeGreaterThan(0);
    expect(await t.db.select().from(practiceFacts)).toHaveLength(0);
    expect(await t.db.select().from(contacts)).toHaveLength(0);
    expect(rows).toHaveLength(1); // the wasted call still cost money
  });

  it("EDGE CASE: an empty extract result is failed, not a fabricated brief", async () => {
    const practiceId = await seedPractice("Quiet Practice", "reno-nv");
    const empty = new FakeExtractClient(async () => ({
      text: "{}",
      usage: {
        inputTokens: 800,
        outputTokens: 4,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
        webSearchRequests: 0,
        webFetchRequests: 0,
      },
      model: "claude-haiku-4-5",
    }));
    const { deps: d, rows } = deps(SUNSHINE_PAGES, empty, FakePdlClient.fromFixture(personMatch));

    const result = await enrichPractice(d, {
      id: practiceId,
      name: "Quiet Practice",
      websiteUrl: SUNSHINE.websiteUrl,
    });

    expect(result.status).toBe("failed");
    expect(result.reason).toMatch(/no verified facts/);
    expect(result.factsWritten).toBe(0);
    expect(result.factsDropped).toBe(0); // nothing to drop; the model reported nothing
    expect(rows).toHaveLength(1); // the call still cost money
  });

  // ─── Escalation: fires on a bad RESULT, never on a throw (KTD-7) ───────────

  it("a thin scrape ESCALATES exactly once, and the agentic findings are persisted", async () => {
    const practiceId = await seedPractice("Blocked Derm", "miami-fl");
    const agentic = FakeResearchClient.fromFixture(researchFixture);
    const budget = createEscalationBudget(3);
    const { meter, rows } = recordingMeter();

    const result = await enrichPractice(
      {
        db: t.db,
        scrape: emptyScraper("blocked").scrape,
        extract: FakeExtractClient.fromFixture(researchFixture),
        pdl: FakePdlClient.fromFixture(personNotFound),
        meter,
        escalation: { client: agentic, budget },
        now: () => NOW,
        logger: SILENT,
      },
      { id: practiceId, name: "Blocked Derm", websiteUrl: "https://blocked.example" },
    );

    expect(result.status).toBe("enriched");
    expect(result.escalationTrigger).toBe("thin-scrape");
    expect(result.escalated).toBe(true);
    // EXACTLY ONCE. There is no loop here, and a second thin result has nowhere to go.
    expect(agentic.calls).toHaveLength(1);
    expect(budget.spent).toBe(1);

    // We hold no pages, so nothing the agentic path said can be proven. It is persisted
    // at the pre-refactor assurance level, and counted so a reader knows.
    // 7 CITED FACTS (5 practice_facts + the contact's name and role), 5 practice_facts
    // rows. `factsUnverifiable` and `factsDropped` count citations; `factsWritten` counts
    // rows. The decision-maker is a fact you can be wrong about too.
    expect(result.factsUnverifiable).toBe(7);
    expect(result.factsWritten).toBe(5);
    expect(result.factsDropped).toBe(0);
    // The Haiku extractor was never called: there was nothing to hand it.
    expect(rows.filter((r) => r.pipelineStep === "enrich.extract")).toHaveLength(0);
    expect(rows.filter((r) => r.pipelineStep === "enrich.research")).toHaveLength(1);
  });

  it("zero verified facts ESCALATES — extraction succeeded and nothing threw", async () => {
    // The case the old mechanism could not see, and Optiflow's Gate 4 throws away.
    const practiceId = await seedPractice("Fabulist Derm", "miami-fl");
    const base = parseMessagesResponse(researchFixture);
    const allFake = new FakeExtractClient(async () => ({
      ...base,
      text: base.text.replaceAll(/"snippet": "[^"]*"/g, '"snippet": "Nothing on any page says this."'),
    }));
    const budget = createEscalationBudget(3);

    const result = await enrichPractice(
      {
        db: t.db,
        scrape: fakeScraper(SUNSHINE_PAGES).scrape,
        extract: allFake,
        pdl: FakePdlClient.fromFixture(personNotFound),
        meter: recordingMeter().meter,
        escalation: { client: FakeResearchClient.fromFixture(researchFixture), budget },
        now: () => NOW,
        logger: SILENT,
      },
      { id: practiceId, name: "Fabulist Derm", websiteUrl: SUNSHINE.websiteUrl },
    );

    expect(result.escalationTrigger).toBe("no-verified-facts");
    expect(result.escalated).toBe(true);
    expect(result.status).toBe("enriched");
    // We hold pages, but they are `cleanHtml`'s pruned and reordered copy — NOT what the
    // agentic model read off the live web. They cannot adjudicate its snippets, so every
    // agentic fact is `unverifiable` rather than falsely refuted. See `escalation.ts`.
    expect(result.factsUnverifiable).toBe(7);
    expect(result.factsDropped).toBeGreaterThan(0); // the PRIMARY path's drops, still counted
    expect(await t.db.select().from(practiceFacts)).toHaveLength(5);
  });

  it("a THROWN escalation is UNBILLED — `escalated` must not claim $1.27 that never left", async () => {
    // The inverse of the Westlake $0.00 bug: free reported as paid. U8's escalation-spend
    // readout is derived from this field.
    const practiceId = await seedPractice("Blocked Derm", "miami-fl");
    const budget = createEscalationBudget(3);
    const { meter, rows } = recordingMeter();

    const result = await enrichPractice(
      {
        db: t.db,
        scrape: emptyScraper("unreachable").scrape,
        extract: FakeExtractClient.fromFixture(researchFixture),
        pdl: FakePdlClient.fromFixture(personNotFound),
        meter,
        escalation: {
          client: FakeResearchClient.throwing(new AnthropicRequestError(429, "rate limited")),
          budget,
        },
        now: () => NOW,
        logger: SILENT,
      },
      { id: practiceId, name: "Blocked Derm", websiteUrl: "https://blocked.example" },
    );

    expect(result.status).toBe("failed");
    expect(result.escalationTrigger).toBe("thin-scrape");
    expect(result.escalated).toBe(false); // nothing was bought
    expect(rows).toEqual([]); // and the meter agrees
    expect(budget.spent).toBe(1); // the attempt is still counted: the cap under-authorizes
  });

  it("a VERIFIED result never escalates — no wasted $1.27", async () => {
    const practiceId = await seedPractice(SUNSHINE.name, SUNSHINE.geoKey);
    const agentic = FakeResearchClient.fromFixture(researchFixture);
    const budget = createEscalationBudget(3);

    const result = await enrichPractice(
      {
        db: t.db,
        scrape: fakeScraper(SUNSHINE_PAGES).scrape,
        extract: FakeExtractClient.fromFixture(researchFixture),
        pdl: FakePdlClient.fromFixture(personNotFound),
        meter: recordingMeter().meter,
        escalation: { client: agentic, budget },
        now: () => NOW,
        logger: SILENT,
      },
      { id: practiceId, name: SUNSHINE.name, websiteUrl: SUNSHINE.websiteUrl },
    );

    expect(result.escalationTrigger).toBeNull();
    expect(result.escalated).toBe(false);
    expect(agentic.calls).toEqual([]);
    expect(budget.spent).toBe(0);
  });

  it("KTD-7: a THROWN extractor never escalates — answering a 429 with $1.27 buys nothing", async () => {
    const practiceId = await seedPractice("Rate Limited Derm", "tampa-fl");
    const agentic = FakeResearchClient.fromFixture(researchFixture);

    const result = await enrichPractice(
      {
        db: t.db,
        scrape: fakeScraper(SUNSHINE_PAGES).scrape,
        extract: FakeExtractClient.throwing(new AnthropicRequestError(429, "rate limited")),
        pdl: FakePdlClient.fromFixture(personNotFound),
        meter: recordingMeter().meter,
        escalation: { client: agentic, budget: createEscalationBudget(3) },
        now: () => NOW,
        logger: SILENT,
      },
      { id: practiceId, name: "Rate Limited Derm", websiteUrl: SUNSHINE.websiteUrl },
    );

    expect(result.status).toBe("failed");
    expect(result.escalationTrigger).toBeNull();
    expect(result.escalated).toBe(false);
    expect(agentic.calls).toEqual([]);
  });

  it("U8's setting: a ZERO budget records the trigger and buys NOTHING", async () => {
    const practiceId = await seedPractice("Blocked Derm", "miami-fl");
    const agentic = FakeResearchClient.fromFixture(researchFixture);
    const { meter, rows } = recordingMeter();

    const result = await enrichPractice(
      {
        db: t.db,
        scrape: emptyScraper("unreachable").scrape,
        extract: FakeExtractClient.fromFixture(researchFixture),
        pdl: FakePdlClient.fromFixture(personNotFound),
        meter,
        escalation: { client: agentic, budget: noEscalationBudget() },
        now: () => NOW,
        logger: SILENT,
      },
      { id: practiceId, name: "Blocked Derm", websiteUrl: "https://blocked.example" },
    );

    // This is how U8 measures the escalation rate across a real cohort for $0.
    expect(result.status).toBe("failed");
    expect(result.escalationTrigger).toBe("thin-scrape");
    expect(result.escalated).toBe(false);
    expect(agentic.calls).toEqual([]);
    expect(rows).toEqual([]);
  });

  it("ERROR PATH: a PDL 429 leaves the gap unfilled but keeps the enrichment", async () => {
    const practiceId = await seedPractice(SUNSHINE.name, SUNSHINE.geoKey);
    const pdl = FakePdlClient.throwing(new PdlRateLimitError(30));
    const { deps: d, rows } = deps(
      SUNSHINE_PAGES,
      FakeExtractClient.fromFixture(researchFixture),
      pdl,
    );

    const result = await enrichPractice(d, {
      id: practiceId,
      name: SUNSHINE.name,
      websiteUrl: SUNSHINE.websiteUrl,
    });

    expect(result.status).toBe("enriched");
    expect(result.factsWritten).toBe(5);
    // 429 is unbilled -> no PDL cost row, only the Anthropic one.
    expect(rows.filter((r) => r.provider === "pdl")).toHaveLength(0);

    const [contact] = await t.db
      .select()
      .from(contacts)
      .where(eq(contacts.practiceId, practiceId));
    expect(contact.name).toBe("Dana Whitfield");
    expect(contact.email).toBeNull();
    expect(contact.linkedinUrl).toBeNull();
  });

  it("ERROR PATH: a PDL 404 no-match degrades the contact, still metered at $0", async () => {
    const practiceId = await seedPractice(SUNSHINE.name, SUNSHINE.geoKey);
    const { deps: d, rows } = deps(
      SUNSHINE_PAGES,
      FakeExtractClient.fromFixture(researchFixture),
      FakePdlClient.fromFixture(personNotFound),
    );

    const result = await enrichPractice(d, {
      id: practiceId,
      name: SUNSHINE.name,
      websiteUrl: SUNSHINE.websiteUrl,
    });

    expect(result.pdlCalls).toBe(1);
    const pdlRow = rows.find((r) => r.provider === "pdl")!;
    expect(pdlRow.units).toBe(0);
    expect(pdlRow.costUsd).toBe(0);

    const [contact] = await t.db
      .select()
      .from(contacts)
      .where(eq(contacts.practiceId, practiceId));
    expect(contact.email).toBeNull();
  });

  it("re-running the waterfall is idempotent — no duplicate facts, no clobbered email", async () => {
    const practiceId = await seedPractice(SUNSHINE.name, SUNSHINE.geoKey);
    const run = () =>
      enrichPractice(
        deps(
          SUNSHINE_PAGES,
          FakeExtractClient.fromFixture(researchFixture),
          FakePdlClient.fromFixture(personMatch),
        ).deps,
        { id: practiceId, name: SUNSHINE.name, websiteUrl: SUNSHINE.websiteUrl },
      );

    const first = await run();
    const second = await run();

    expect(first.factsWritten).toBe(5);
    expect(second.factsWritten).toBe(0); // ON CONFLICT DO NOTHING
    expect(await t.db.select().from(practiceFacts)).toHaveLength(5);
    expect(await t.db.select().from(contacts)).toHaveLength(1);
  });

  it("COST GUARD: a re-run does NOT re-buy a gap the database already filled", async () => {
    const practiceId = await seedPractice(SUNSHINE.name, SUNSHINE.geoKey);
    // ONE client + ONE meter across both runs, so the call and the money are counted
    // end-to-end rather than reset between them.
    const pdl = FakePdlClient.fromFixture(personMatch);
    const { meter, rows } = recordingMeter();
    const d: WaterfallDeps = {
      db: t.db,
      scrape: fakeScraper(SUNSHINE_PAGES).scrape,
      extract: FakeExtractClient.fromFixture(researchFixture),
      pdl,
      meter,
      now: () => NOW,
      logger: SILENT,
    };
    const practice = { id: practiceId, name: SUNSHINE.name, websiteUrl: SUNSHINE.websiteUrl };

    const first = await enrichPractice(d, practice);
    const second = await enrichPractice(d, practice);

    expect(first.pdlCalls).toBe(1);
    // Claude leaves the same gap again, but the stored contact now fills it — and
    // `upsertContact` would discard whatever PDL returned anyway.
    expect(second.pdlCalls).toBe(0);
    expect(pdl.personCalls).toHaveLength(1);
    expect(rows.filter((r) => r.provider === "pdl")).toHaveLength(1);
    // The extract call is NOT cached; it is bought again, and metered again.
    expect(rows.filter((r) => r.provider === "anthropic")).toHaveLength(2);
  });

  it("a DRIFTED role is a different contact — PDL fills it, and no row is left empty", async () => {
    // `contacts` has no unique constraint and `role` is free text from the model, so a
    // re-run under a new title INSERTS a second row. The cost guard must read on the
    // same (practice, role) key `upsertContact` writes on — otherwise the old row's
    // email suppresses the PDL call and the new row is persisted empty.
    const practiceId = await seedPractice(SUNSHINE.name, SUNSHINE.geoKey);
    const pdl = FakePdlClient.fromFixture(personMatch);
    const { meter } = recordingMeter();
    const withExtract = (
      extract: FakeExtractClient,
      held: Map<string, string> = SUNSHINE_PAGES,
    ): WaterfallDeps => ({
      db: t.db,
      scrape: fakeScraper(held).scrape,
      extract,
      pdl,
      meter,
      now: () => NOW,
      logger: SILENT,
    });
    const practice = { id: practiceId, name: SUNSHINE.name, websiteUrl: SUNSHINE.websiteUrl };

    // Dana was RE-TITLED, so the PAGE drifts and the model quotes the new page. Drifting
    // only the model's `value` would leave "Practice Manager" cited to a page that still
    // says "Practice Administrator" — a fabrication `citations.ts` is required to drop,
    // and this test would then be asserting the opposite of the guarantee.
    const base = parseMessagesResponse(researchFixture);
    const drifted = new FakeExtractClient(async () => ({
      ...base,
      text: base.text
        .replaceAll('"value": "Practice Administrator"', '"value": "Practice Manager"')
        .replaceAll(
          '"snippet": "Dana Whitfield, Practice Administrator"',
          '"snippet": "Dana Whitfield, Practice Manager"',
        ),
    }));

    await enrichPractice(withExtract(FakeExtractClient.fromFixture(researchFixture)), practice);
    const second = await enrichPractice(
      withExtract(drifted, SUNSHINE_PAGES_ROLE_DRIFTED),
      practice,
    );

    // The drifted role is an unfilled contact, so PDL is bought for it.
    expect(second.pdlCalls).toBe(1);

    const rows = await t.db
      .select()
      .from(contacts)
      .where(eq(contacts.practiceId, practiceId));
    expect(rows.map((r) => r.role).sort()).toEqual([
      "Practice Administrator",
      "Practice Manager",
    ]);
    // Neither row is empty — the guard saved money, it did not eat the data.
    for (const row of rows) {
      expect(row.email).toBe("dana.whitfield@sunshinederm.example");
      expect(row.linkedinUrl).toBe(
        "https://linkedin.com/in/dana-whitfield-example",
      );
    }
  });
});

describe("enrichment persistence primitives", () => {
  let t: TestDb;
  beforeEach(async () => {
    t = await createTestDb();
  });
  afterEach(async () => {
    await t.close();
  });

  it("upsertPracticeFact never overwrites a real record", async () => {
    const { practiceId } = await resolvePractice(t.db, {
      name: "Sunshine Dermatology",
      geoKey: "miami-fl",
    });
    const base = {
      practiceId,
      field: "ehr",
      provider: "claude_research" as const,
      detectedAt: NOW,
    };
    const first = await upsertPracticeFact(t.db, {
      ...base,
      value: "ModMed EMA",
      sourceUrl: "https://a.example.com",
      snippet: "powered by ModMed EMA",
    });
    const second = await upsertPracticeFact(t.db, {
      ...base,
      value: "Epic",
      sourceUrl: "https://b.example.com",
      snippet: "we use Epic",
    });

    expect(first.status).toBe("written");
    expect(second.status).toBe("duplicate");
    const [row] = await t.db.select().from(practiceFacts);
    expect(row.value).toBe("ModMed EMA");
  });

  it("upsertContact fills NULL columns only — a stored email is never clobbered", async () => {
    const { practiceId } = await resolvePractice(t.db, {
      name: "Sunshine Dermatology",
      geoKey: "miami-fl",
    });
    await upsertContact(t.db, {
      practiceId,
      role: "Practice Administrator",
      name: "Dana Whitfield",
      email: "dana@cited.example",
      emailProvider: "claude_research",
    });
    const second = await upsertContact(t.db, {
      practiceId,
      role: "Practice Administrator",
      email: "dana@pdl-guess.example",
      emailProvider: "pdl",
      linkedinUrl: "linkedin.com/in/dana",
      linkedinProvider: "pdl",
    });

    expect(second.created).toBe(false);
    expect(second.filled).toEqual(["linkedinUrl"]);

    const [row] = await t.db.select().from(contacts);
    expect(row.email).toBe("dana@cited.example");
    expect(row.emailProvider).toBe("claude_research");
    expect(row.linkedinUrl).toBe("linkedin.com/in/dana");
    expect(row.linkedinProvider).toBe("pdl");
  });
});
