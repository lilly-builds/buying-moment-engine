import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../setup";
import fullyResolved from "./fixtures/anthropic-research-fully-resolved.json";
import researchFixture from "./fixtures/anthropic-research-response.json";
import roleOnly from "./fixtures/anthropic-research-role-only.json";
import personMatch from "./fixtures/pdl-person-enrich-match.json";
import personNotFound from "./fixtures/pdl-person-enrich-404.json";
import { FakePdlClient, FakeResearchClient, recordingMeter } from "./doubles";
import { drizzleCostRecorder } from "@/db/cost-recorder";
import { contacts, costEvents, evidence, practiceFacts, practices } from "@/db/schema";
import { upsertContact, upsertPracticeFact } from "@/db/enrich";
import { resolvePractice } from "@/src/engine/resolver";
import { enrichPractice, type WaterfallDeps } from "@/src/enrich/waterfall";
import { PdlRateLimitError } from "@/src/enrich/types";
import { createMeter } from "@/src/roi/cost-meter";

/**
 * FULL-SEAM INTEGRATION (U5's Definition of Done): research -> gap-fill ->
 * enriched row persisted, on ephemeral PGlite with the externals mocked via
 * recorded fixtures. Nothing here reaches the network; nothing sends (D9).
 */

const NOW = new Date("2026-07-08T12:00:00Z");
const SILENT = () => {};

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
    research: FakeResearchClient,
    pdl: FakePdlClient,
  ): { deps: WaterfallDeps; rows: ReturnType<typeof recordingMeter>["rows"] } {
    const { meter, rows } = recordingMeter();
    return {
      deps: { db: t.db, research, pdl, meter, now: () => NOW, logger: SILENT },
      rows,
    };
  }

  it("SCENARIO 3: PDL fills the verified email + LinkedIn gap and persists them", async () => {
    const practiceId = await seedPractice(
      "Sunshine Dermatology Associates",
      "miami-fl",
    );
    const research = FakeResearchClient.fromFixture(researchFixture);
    const pdl = FakePdlClient.fromFixture(personMatch);
    const { deps: d } = deps(research, pdl);

    const result = await enrichPractice(d, {
      id: practiceId,
      name: "Sunshine Dermatology Associates",
      city: "Miami",
      state: "FL",
    });

    expect(result.status).toBe("enriched");
    expect(result.pdlCalls).toBe(1);
    expect(result.contactVariant).toBe("named");

    const [contact] = await t.db
      .select()
      .from(contacts)
      .where(eq(contacts.practiceId, practiceId));
    expect(contact.name).toBe("Dana Whitfield");
    expect(contact.role).toBe("Practice Administrator");
    expect(contact.email).toBe("dana.whitfield@sunshinederm.example");
    expect(contact.emailProvider).toBe("pdl");
    expect(contact.linkedinUrl).toBe("linkedin.com/in/dana-whitfield-example");
    expect(contact.linkedinProvider).toBe("pdl");
    // The page Claude cited for name/role survives alongside PDL's fill.
    expect(contact.sourceUrl).toBe("https://sunshinederm.example/team");
  });

  it("SCENARIO 4 (COST GUARD): a fully-Claude-resolved practice makes ZERO PDL calls", async () => {
    const practiceId = await seedPractice("Metro Ortho Group", "denver-co");
    const research = FakeResearchClient.fromFixture(fullyResolved);
    const pdl = FakePdlClient.fromFixture(personMatch);
    const { deps: d, rows } = deps(research, pdl);

    const result = await enrichPractice(d, {
      id: practiceId,
      name: "Metro Ortho Group",
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
    const research = FakeResearchClient.fromFixture(roleOnly);
    const pdl = FakePdlClient.fromFixture(personMatch);
    const { deps: d } = deps(research, pdl);

    const result = await enrichPractice(d, {
      id: practiceId,
      name: "Harbor Vision Eye Care",
    });

    expect(result.status).toBe("enriched");
    expect(result.contactVariant).toBe("role_only");
    expect(result.pdlCalls).toBe(0);
    expect(pdl.personCalls).toEqual([]);

    const [contact] = await t.db
      .select()
      .from(contacts)
      .where(eq(contacts.practiceId, practiceId));
    expect(contact.name).toBeNull();
    expect(contact.role).toBe("Office Manager");
    expect(contact.email).toBeNull();
  });

  it("SCENARIO 8: every enrichment call writes a metered cost_events row", async () => {
    const practiceId = await seedPractice(
      "Sunshine Dermatology Associates",
      "miami-fl",
    );
    const meter = createMeter(drizzleCostRecorder(t.db));
    await enrichPractice(
      {
        db: t.db,
        research: FakeResearchClient.fromFixture(researchFixture),
        pdl: FakePdlClient.fromFixture(personMatch),
        meter,
        now: () => NOW,
        logger: SILENT,
      },
      { id: practiceId, name: "Sunshine Dermatology Associates" },
    );

    const rows = await t.db
      .select()
      .from(costEvents)
      .where(eq(costEvents.practiceId, practiceId));
    expect(rows).toHaveLength(2);

    const anthropic = rows.find((r) => r.provider === "anthropic")!;
    expect(anthropic.operation).toBe("messages.create");
    expect(anthropic.pipelineStep).toBe("enrich.research");
    expect(Number(anthropic.costUsd)).toBeGreaterThan(0);

    const pdlRow = rows.find((r) => r.provider === "pdl")!;
    expect(pdlRow.operation).toBe("person.enrich");
    expect(Number(pdlRow.units)).toBe(1);
    expect(Number(pdlRow.costUsd)).toBeCloseTo(0.28, 10);
  });

  it("persists every fact with an evidence row carrying source URL + snippet + detected_at", async () => {
    const practiceId = await seedPractice(
      "Sunshine Dermatology Associates",
      "miami-fl",
    );
    const { deps: d } = deps(
      FakeResearchClient.fromFixture(researchFixture),
      FakePdlClient.fromFixture(personNotFound),
    );

    const result = await enrichPractice(d, {
      id: practiceId,
      name: "Sunshine Dermatology Associates",
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
    }
    expect(facts.find((f) => f.field === "ehr")?.value).toBe("ModMed EMA");
  });

  it("tags the vertical from the practice's own words", async () => {
    const practiceId = await seedPractice("Metro Ortho Group", "denver-co");
    const { deps: d } = deps(
      FakeResearchClient.fromFixture(fullyResolved),
      FakePdlClient.fromFixture(personNotFound),
    );

    const result = await enrichPractice(d, {
      id: practiceId,
      name: "Metro Ortho Group",
    });
    expect(result.vertical).toBe("orthopedics");

    const [row] = await t.db
      .select()
      .from(practices)
      .where(eq(practices.id, practiceId));
    expect(row.vertical).toBe("orthopedics");
    expect(row.enrichmentStatus).toBe("enriched");
  });

  it("ERROR PATH: malformed research JSON marks the practice failed and writes no facts", async () => {
    const practiceId = await seedPractice("Broken Derm", "austin-tx");
    const pdl = FakePdlClient.fromFixture(personMatch);
    const { deps: d, rows } = deps(FakeResearchClient.malformed(), pdl);

    const result = await enrichPractice(d, {
      id: practiceId,
      name: "Broken Derm",
    });

    expect(result.status).toBe("failed");
    expect(result.reason).toMatch(/malformed JSON/);
    expect(pdl.personCalls).toEqual([]);
    // The Claude call still cost money and is still metered.
    expect(rows).toHaveLength(1);

    expect(await t.db.select().from(practiceFacts)).toHaveLength(0);
    expect(await t.db.select().from(contacts)).toHaveLength(0);
    const [row] = await t.db
      .select()
      .from(practices)
      .where(eq(practices.id, practiceId));
    expect(row.enrichmentStatus).toBe("failed");
  });

  it("ERROR PATH: a PDL 429 leaves the gap unfilled but keeps the enrichment", async () => {
    const practiceId = await seedPractice(
      "Sunshine Dermatology Associates",
      "miami-fl",
    );
    const pdl = FakePdlClient.throwing(new PdlRateLimitError(30));
    const { deps: d, rows } = deps(
      FakeResearchClient.fromFixture(researchFixture),
      pdl,
    );

    const result = await enrichPractice(d, {
      id: practiceId,
      name: "Sunshine Dermatology Associates",
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
    const practiceId = await seedPractice(
      "Sunshine Dermatology Associates",
      "miami-fl",
    );
    const { deps: d, rows } = deps(
      FakeResearchClient.fromFixture(researchFixture),
      FakePdlClient.fromFixture(personNotFound),
    );

    const result = await enrichPractice(d, {
      id: practiceId,
      name: "Sunshine Dermatology Associates",
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

  it("EDGE CASE: an empty research result is failed, not a fabricated brief", async () => {
    const practiceId = await seedPractice("Silent Practice", "reno-nv");
    const empty = new FakeResearchClient(async () => ({
      text: "{}",
      usage: {
        inputTokens: 800,
        outputTokens: 4,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
        webSearchRequests: 2,
        webFetchRequests: 0,
      },
      model: "claude-sonnet-5",
    }));
    const { deps: d, rows } = deps(empty, FakePdlClient.fromFixture(personMatch));

    const result = await enrichPractice(d, {
      id: practiceId,
      name: "Silent Practice",
    });

    expect(result.status).toBe("failed");
    expect(result.reason).toBe("research returned no facts");
    expect(result.factsWritten).toBe(0);
    expect(rows).toHaveLength(1); // the wasted search still cost money
  });

  it("re-running the waterfall is idempotent — no duplicate facts, no clobbered email", async () => {
    const practiceId = await seedPractice(
      "Sunshine Dermatology Associates",
      "miami-fl",
    );
    const run = () =>
      enrichPractice(
        deps(
          FakeResearchClient.fromFixture(researchFixture),
          FakePdlClient.fromFixture(personMatch),
        ).deps,
        { id: practiceId, name: "Sunshine Dermatology Associates" },
      );

    const first = await run();
    const second = await run();

    expect(first.factsWritten).toBe(5);
    expect(second.factsWritten).toBe(0); // ON CONFLICT DO NOTHING
    expect(await t.db.select().from(practiceFacts)).toHaveLength(5);
    expect(await t.db.select().from(contacts)).toHaveLength(1);
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
