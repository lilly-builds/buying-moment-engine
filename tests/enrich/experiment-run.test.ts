import { describe, expect, it } from "vitest";
import companyMatch from "./fixtures/pdl-company-enrich-match.json";
import fullyResolved from "./fixtures/anthropic-research-fully-resolved.json";
import personMatch from "./fixtures/pdl-person-enrich-match.json";
import personNotFound from "./fixtures/pdl-person-enrich-404.json";
import researchFixture from "./fixtures/anthropic-research-response.json";
import roleOnly from "./fixtures/anthropic-research-role-only.json";
import { FakePdlClient, FakeResearchClient, fixtureHttpStatus } from "./doubles";
import {
  normalizeCompanyResponse,
  normalizePersonResponse,
} from "@/src/enrich/pdl-client";
import { runCohortEntry, spendFor, teeRecorder } from "@/src/enrich/experiment-run";
import type { CohortEntry } from "@/src/enrich/experiment-metrics";
import type { CostEventRecord, CostRecorder } from "@/src/roi/cost-meter";

/**
 * The experiment harness itself, driven through recorded fixtures. Zero paid calls;
 * this proves the SCORING is right so the orchestrator's live run is interpretable.
 */

const ENTRY: CohortEntry = {
  key: "sunshine-derm-miami",
  name: "Sunshine Dermatology Associates",
  city: "Miami",
  state: "FL",
  geoKey: "miami-fl",
  locationsCount: 3,
  verticalHint: "dermatology",
};

function ledger(): { recorder: CostRecorder; rows: CostEventRecord[] } {
  const rows: CostEventRecord[] = [];
  return { recorder: { record: async (row) => void rows.push(row) }, rows };
}

function pdlBoth(person: unknown, company: unknown): FakePdlClient {
  return new FakePdlClient(
    async () => normalizePersonResponse(person, fixtureHttpStatus(person)),
    async () => normalizeCompanyResponse(company, fixtureHttpStatus(company)),
  );
}

describe("experiment #1 — per-record scoring", () => {
  it("scores BOTH providers over the same practice, per field", async () => {
    const { recorder, rows } = ledger();
    const record = await runCohortEntry(
      ENTRY,
      {
        research: FakeResearchClient.fromFixture(researchFixture),
        pdl: pdlBoth(personMatch, companyMatch),
        recorder,
      },
      "practice-1",
    );

    expect(record.key).toBe("sunshine-derm-miami");
    expect(record.sizeBand).toBe("mid_large");

    // Claude found specialty, locations and the EHR — but no email/LinkedIn.
    expect(record.claude.ok).toBe(true);
    expect(record.claude.company).toMatchObject({
      specialty: true,
      locationsCount: true,
      ehr: true,
      providerCount: false,
    });
    expect(record.claude.person).toMatchObject({
      name: true,
      role: true,
      email: false,
      linkedinUrl: false,
    });

    // PDL: firmographics yes, EHR never.
    expect(record.pdlCompany.matched).toBe(true);
    expect(record.pdlCompany.company).toMatchObject({
      specialty: true,
      locationsCount: true,
      ehr: false,
    });

    // PDL filled the person gap Claude left.
    expect(record.pdlPerson.attempted).toBe(true);
    expect(record.pdlPerson.person).toMatchObject({
      email: true,
      linkedinUrl: true,
      name: false,
      role: false,
    });

    // Cost is attributed from the metered rows, per operation.
    expect(rows).toHaveLength(3);
    expect(record.claude.costUsd).toBeCloseTo(spendFor(rows, "anthropic"), 12);
    expect(record.pdlCompany.costUsd).toBeCloseTo(0.28, 10);
    expect(record.pdlPerson.costUsd).toBeCloseTo(0.28, 10);
  });

  it("records the honest limitation when Claude finds no NAME to key PDL on", async () => {
    const { recorder } = ledger();
    const pdl = pdlBoth(personMatch, companyMatch);

    const record = await runCohortEntry(
      { ...ENTRY, key: "harbor", name: "Harbor Vision Eye Care", locationsCount: 1 },
      { research: FakeResearchClient.fromFixture(roleOnly), pdl, recorder },
      "practice-2",
    );

    expect(record.sizeBand).toBe("small");
    expect(record.claude.person.name).toBe(false);
    expect(record.pdlPerson.attempted).toBe(false);
    expect(record.pdlPerson.skipReason).toMatch(/keys on a person's name/);
    expect(record.pdlPerson.costUsd).toBe(0);
    // The person lookup was never made — only the company one.
    expect(pdl.personCalls).toEqual([]);
    expect(pdl.companyCalls).toBe(1);
  });

  it("a fully-Claude-resolved contact still runs PDL — the experiment MEASURES the split", async () => {
    const { recorder } = ledger();
    const pdl = pdlBoth(personMatch, companyMatch);

    const record = await runCohortEntry(
      { ...ENTRY, key: "metro", name: "Metro Ortho Group" },
      { research: FakeResearchClient.fromFixture(fullyResolved), pdl, recorder },
      "practice-3",
    );

    // The production waterfall would spend $0 here; the harness deliberately does
    // not, because a hit-rate needs both providers attempted on the same record.
    expect(record.claude.person.email).toBe(true);
    expect(record.pdlPerson.attempted).toBe(true);
    expect(pdl.personCalls).toHaveLength(1);
  });

  it("ERROR PATH: a failed Claude call is recorded, not thrown, and PDL still runs", async () => {
    const { recorder } = ledger();
    const record = await runCohortEntry(
      ENTRY,
      {
        research: FakeResearchClient.malformed(),
        pdl: pdlBoth(personMatch, companyMatch),
        recorder,
      },
      "practice-4",
    );

    expect(record.claude.ok).toBe(false);
    expect(record.claude.error).toMatch(/malformed JSON/);
    expect(record.claude.costUsd).toBeGreaterThan(0); // billed anyway
    expect(record.pdlCompany.attempted).toBe(true);
    expect(record.pdlPerson.attempted).toBe(false);
  });

  it("ERROR PATH: a PDL failure is recorded per-provider, never sinks the record", async () => {
    const { recorder } = ledger();
    const record = await runCohortEntry(
      ENTRY,
      {
        research: FakeResearchClient.fromFixture(researchFixture),
        pdl: FakePdlClient.throwing(new Error("PDL 500")),
        recorder,
      },
      "practice-5",
    );

    expect(record.claude.ok).toBe(true);
    expect(record.pdlCompany.error).toBe("PDL 500");
    expect(record.pdlPerson.error).toBe("PDL 500");
    expect(record.pdlCompany.costUsd).toBe(0);
  });

  it("a PDL 404 no-match is scored as a miss, not an error", async () => {
    const { recorder } = ledger();
    const record = await runCohortEntry(
      ENTRY,
      {
        research: FakeResearchClient.fromFixture(researchFixture),
        pdl: pdlBoth(personNotFound, { status: 404 }),
        recorder,
      },
      "practice-6",
    );

    expect(record.pdlCompany.error).toBeNull();
    expect(record.pdlCompany.matched).toBe(false);
    expect(record.pdlPerson.matched).toBe(false);
    expect(record.pdlPerson.person.email).toBe(false);
    expect(record.pdlPerson.costUsd).toBe(0);
  });
});

describe("teeRecorder + spendFor", () => {
  it("writes to the real ledger AND the in-memory tally", async () => {
    const { recorder, rows } = ledger();
    const sink: CostEventRecord[] = [];
    const row: CostEventRecord = {
      provider: "pdl",
      operation: "person.enrich",
      pipelineStep: "enrich.pdl",
      units: 1,
      unitCostUsd: 0.28,
      costUsd: 0.28,
    };

    await teeRecorder(recorder, sink).record(row);

    expect(rows).toEqual([row]);
    expect(sink).toEqual([row]);
    expect(spendFor(sink, "pdl", "person.enrich")).toBe(0.28);
    expect(spendFor(sink, "pdl", "company.enrich")).toBe(0);
    expect(spendFor(sink, "anthropic")).toBe(0);
  });
});
