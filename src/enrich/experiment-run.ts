import {
  sizeBand,
  type CohortEntry,
  type ExperimentRecord,
} from "./experiment-metrics";
import { runPdlCompanyEnrich, runPdlPersonEnrich } from "./pdl";
import { runResearch } from "./research";
import type { PdlClient, ResearchClient } from "./types";
import {
  createMeter,
  type CostEventRecord,
  type CostRecorder,
} from "@/src/roi/cost-meter";

/**
 * One cohort record of stack-validation experiment #1: run BOTH providers over the
 * SAME practice and score every field independently, so the waterfall split can be
 * decided per field rather than per record.
 *
 * Clients + recorder are injected, so this runs against fixtures in a test and
 * against live APIs from `scripts/experiment-1-waterfall-split.ts`.
 *
 * R19: every paid call goes through `createMeter`, and the recorder TEES — real
 * `cost_events` rows for the scoreboard, plus an in-memory tally so the harness
 * can attribute spend per record and per operation without re-querying.
 *
 * HONEST LIMITATION: PDL's Person Enrichment keys on a person's name + company, so
 * it cannot discover a decision-maker the way Claude can. Where Claude finds no
 * name, `pdlPerson.attempted` is false with a `skipReason`. That asymmetry IS a
 * finding — the summary must never hide it behind an averaged rate.
 */

export interface ExperimentClients {
  research: ResearchClient;
  pdl: PdlClient;
  recorder: CostRecorder;
}

/** Tees every metered row into the real ledger AND an in-memory per-record tally. */
export function teeRecorder(
  downstream: CostRecorder,
  sink: CostEventRecord[],
): CostRecorder {
  return {
    async record(row) {
      sink.push(row);
      await downstream.record(row);
    },
  };
}

/** Attribute spend from the metered rows themselves — never re-derive a price here. */
export function spendFor(
  rows: CostEventRecord[],
  provider: string,
  operation?: string,
): number {
  return rows
    .filter(
      (r) =>
        r.provider === provider &&
        (operation === undefined || r.operation === operation),
    )
    .reduce((total, r) => total + r.costUsd, 0);
}

function emptyRecord(entry: CohortEntry): ExperimentRecord {
  return {
    key: entry.key,
    name: entry.name,
    sizeBand: sizeBand(entry.locationsCount),
    verticalHint: entry.verticalHint,
    ranAt: new Date().toISOString(),
    claude: { ok: false, company: {}, person: {}, costUsd: 0, error: null },
    pdlCompany: {
      attempted: false,
      matched: false,
      company: {},
      costUsd: 0,
      error: null,
    },
    pdlPerson: {
      attempted: false,
      skipReason: null,
      matched: false,
      person: {},
      costUsd: 0,
      error: null,
    },
  };
}

const message = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);

export async function runCohortEntry(
  entry: CohortEntry,
  clients: ExperimentClients,
  practiceId: string,
): Promise<ExperimentRecord> {
  const spend: CostEventRecord[] = [];
  const meter = createMeter(teeRecorder(clients.recorder, spend));
  const record = emptyRecord(entry);

  // ── (a) company firmographics/EHR + (b) decision-maker, via ONE Claude call.
  let decisionMakerName: string | null = null;
  try {
    const outcome = await runResearch(
      { client: clients.research, meter, practiceId },
      {
        practiceName: entry.name,
        city: entry.city,
        state: entry.state,
        websiteUrl: entry.websiteUrl,
      },
    );
    if (outcome.ok) {
      const f = outcome.findings;
      decisionMakerName = f.decisionMaker?.name?.value ?? null;
      record.claude.ok = true;
      record.claude.company = {
        specialty: f.firmographics.specialty !== undefined,
        locationsCount: f.firmographics.locationsCount !== undefined,
        providerCount: f.firmographics.providerCount !== undefined,
        website: f.firmographics.website !== undefined,
        ehr: f.ehr !== null,
      };
      record.claude.person = {
        name: f.decisionMaker?.name != null,
        role: f.decisionMaker != null,
        email: f.decisionMaker?.email != null,
        linkedinUrl: f.decisionMaker?.linkedinUrl != null,
      };
    } else {
      record.claude.error = outcome.reason;
    }
  } catch (err) {
    record.claude.error = message(err);
  }
  record.claude.costUsd = spendFor(spend, "anthropic");

  // ── (a) via PDL: Company Enrichment.
  try {
    record.pdlCompany.attempted = true;
    const company = await runPdlCompanyEnrich(
      { client: clients.pdl, meter, practiceId },
      { companyName: entry.name, website: entry.websiteUrl },
    );
    record.pdlCompany.matched = company.matched;
    record.pdlCompany.company = {
      // PDL's `industry` is the closest thing it has to a specialty.
      specialty: company.industry !== null,
      locationsCount: company.locationsCount !== null,
      // PDL reports headcount, never a clinical provider count.
      providerCount: false,
      website: company.website !== null,
      // PDL has NO EHR data. This zero is the whole point of the experiment.
      ehr: false,
    };
  } catch (err) {
    record.pdlCompany.error = message(err);
  }

  // ── (b) via PDL: Person Enrichment — only possible with a name to key on.
  if (!decisionMakerName) {
    record.pdlPerson.skipReason =
      "PDL Person Enrichment keys on a person's name + company; Claude found no name";
  } else {
    try {
      record.pdlPerson.attempted = true;
      const person = await runPdlPersonEnrich(
        { client: clients.pdl, meter, practiceId },
        { fullName: decisionMakerName, companyName: entry.name },
      );
      record.pdlPerson.matched = person.matched;
      record.pdlPerson.person = {
        // Name + role were HANDED to PDL, so they are not PDL hits.
        name: false,
        role: false,
        email: person.workEmail !== null,
        linkedinUrl: person.linkedinUrl !== null,
      };
    } catch (err) {
      record.pdlPerson.error = message(err);
    }
  }

  record.pdlCompany.costUsd = spendFor(spend, "pdl", "company.enrich");
  record.pdlPerson.costUsd = spendFor(spend, "pdl", "person.enrich");
  return record;
}
