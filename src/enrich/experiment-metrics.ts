import { z } from "zod";

/**
 * Pure scoring for stack-validation experiment #1 (spec § Stack-validation):
 * "Enrichment: Claude (Sonnet 5) vs PDL — for company data AND person data.
 * Measure per-record cost + hit-rate for (a) company firmographics/EHR and
 * (b) the decision-maker's name/role/email/LinkedIn. Decides the exact waterfall
 * split."
 *
 * The split is PER FIELD, not per record — Claude may win firmographics while PDL
 * wins email. So the harness scores every field for every provider independently,
 * and the summary reports a hit-rate per (provider, field) pair.
 *
 * PURE: no I/O. `scripts/experiment-1-waterfall-split.ts` does the paid calls.
 */

// ─── Cohort ───────────────────────────────────────────────────────────────────

export const COHORT_SIZE = 10;
/** Practices with 1-2 locations. The plan's named risk: small-practice coverage. */
export const SMALL_BAND_MIN = 5;
/** Practices with 3+ locations. */
export const LARGE_BAND_MIN = 5;
export const MIN_VERTICALS = 2;

export const cohortEntrySchema = z.object({
  /** Stable resume key. Human-readable (never a UUID) — R-agent-no-uuids. */
  key: z.string().min(1),
  name: z.string().min(1),
  city: z.string().min(1),
  state: z.string().min(1),
  geoKey: z.string().min(1),
  websiteUrl: z.url().optional(),
  /** Verified before the run — the stratification variable, not a guess. */
  locationsCount: z.number().int().min(1),
  /** Expected vertical, used only to check the cohort spans >= 2. */
  verticalHint: z.string().min(1),
});

export type CohortEntry = z.output<typeof cohortEntrySchema>;

export const cohortSchema = z.array(cohortEntrySchema);

export type CohortValidation =
  | { ok: true; cohort: CohortEntry[] }
  | { ok: false; reason: string };

export function sizeBand(locationsCount: number): "small" | "mid_large" {
  return locationsCount <= 2 ? "small" : "mid_large";
}

/**
 * Validate the stratification BEFORE spending a cent. A random n=10 sample would
 * very likely miss the small-practice coverage risk the build plan names — the
 * whole reason experiment #4 folds into this one.
 */
export function validateCohort(input: unknown): CohortValidation {
  const parsed = cohortSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      reason: parsed.error.issues
        .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("; "),
    };
  }
  const cohort = parsed.data;
  if (cohort.length !== COHORT_SIZE) {
    return { ok: false, reason: `cohort must be exactly ${COHORT_SIZE} practices, got ${cohort.length}` };
  }
  const keys = new Set(cohort.map((c) => c.key));
  if (keys.size !== cohort.length) {
    return { ok: false, reason: "cohort keys must be unique (they are the resume key)" };
  }
  const small = cohort.filter((c) => sizeBand(c.locationsCount) === "small");
  if (small.length < SMALL_BAND_MIN) {
    return { ok: false, reason: `need >= ${SMALL_BAND_MIN} small practices (1-2 locations), got ${small.length}` };
  }
  const large = cohort.filter((c) => sizeBand(c.locationsCount) === "mid_large");
  if (large.length < LARGE_BAND_MIN) {
    return { ok: false, reason: `need >= ${LARGE_BAND_MIN} mid/large practices (3+ locations), got ${large.length}` };
  }
  const verticals = new Set(cohort.map((c) => c.verticalHint));
  if (verticals.size < MIN_VERTICALS) {
    return { ok: false, reason: `cohort must span >= ${MIN_VERTICALS} verticals, got ${verticals.size}` };
  }
  return { ok: true, cohort };
}

// ─── Per-record result ────────────────────────────────────────────────────────

export const COMPANY_FIELDS = [
  "specialty",
  "locationsCount",
  "providerCount",
  "website",
  "ehr",
] as const;

export const PERSON_FIELDS = ["name", "role", "email", "linkedinUrl"] as const;

export type CompanyField = (typeof COMPANY_FIELDS)[number];
export type PersonField = (typeof PERSON_FIELDS)[number];

const hitsSchema = z.record(z.string(), z.boolean());

export const experimentRecordSchema = z.object({
  key: z.string(),
  name: z.string(),
  sizeBand: z.enum(["small", "mid_large"]),
  verticalHint: z.string(),
  ranAt: z.string(),
  claude: z.object({
    ok: z.boolean(),
    company: hitsSchema,
    person: hitsSchema,
    costUsd: z.number(),
    error: z.string().nullable().default(null),
  }),
  pdlCompany: z.object({
    attempted: z.boolean(),
    matched: z.boolean(),
    company: hitsSchema,
    costUsd: z.number(),
    error: z.string().nullable().default(null),
  }),
  pdlPerson: z.object({
    attempted: z.boolean(),
    /** false + a reason when Claude found no NAME to look up — PDL person enrich needs one. */
    skipReason: z.string().nullable().default(null),
    matched: z.boolean(),
    person: hitsSchema,
    costUsd: z.number(),
    error: z.string().nullable().default(null),
  }),
});

export type ExperimentRecord = z.output<typeof experimentRecordSchema>;

// ─── Summary ──────────────────────────────────────────────────────────────────

export interface HitRate {
  hits: number;
  attempts: number;
  rate: number;
}

export interface ProviderSummary {
  fields: Record<string, HitRate>;
  totalCostUsd: number;
  costPerRecordUsd: number;
  records: number;
}

export interface ExperimentSummary {
  records: number;
  bySizeBand: Record<string, number>;
  verticals: string[];
  claudeCompany: ProviderSummary;
  claudePerson: ProviderSummary;
  pdlCompany: ProviderSummary;
  pdlPerson: ProviderSummary;
  totalCostUsd: number;
}

function rate(hits: number, attempts: number): HitRate {
  return { hits, attempts, rate: attempts === 0 ? 0 : hits / attempts };
}

function tally(
  records: ExperimentRecord[],
  fields: readonly string[],
  pick: (r: ExperimentRecord) => { hits: Record<string, boolean>; attempted: boolean; costUsd: number },
): ProviderSummary {
  const attempted = records.map(pick).filter((p) => p.attempted);
  const fieldRates: Record<string, HitRate> = {};
  for (const field of fields) {
    const hits = attempted.filter((p) => p.hits[field] === true).length;
    fieldRates[field] = rate(hits, attempted.length);
  }
  const totalCostUsd = records.map(pick).reduce((sum, p) => sum + p.costUsd, 0);
  return {
    fields: fieldRates,
    totalCostUsd,
    costPerRecordUsd: records.length === 0 ? 0 : totalCostUsd / records.length,
    records: attempted.length,
  };
}

/**
 * Roll the append-only record set into the numbers that decide the waterfall
 * split. Hit-rate denominators count only ATTEMPTED calls, so a provider is never
 * penalised for a lookup we deliberately skipped (and never flattered by one).
 */
export function summarize(records: ExperimentRecord[]): ExperimentSummary {
  const bySizeBand: Record<string, number> = {};
  for (const r of records) {
    bySizeBand[r.sizeBand] = (bySizeBand[r.sizeBand] ?? 0) + 1;
  }

  const claudeCompany = tally(records, COMPANY_FIELDS, (r) => ({
    hits: r.claude.company,
    attempted: r.claude.ok,
    costUsd: r.claude.costUsd,
  }));
  const claudePerson = tally(records, PERSON_FIELDS, (r) => ({
    hits: r.claude.person,
    attempted: r.claude.ok,
    // Claude's cost is one call covering both halves — attribute it to the company
    // tally only, so `totalCostUsd` below does not double-count it.
    costUsd: 0,
  }));
  const pdlCompany = tally(records, COMPANY_FIELDS, (r) => ({
    hits: r.pdlCompany.company,
    attempted: r.pdlCompany.attempted,
    costUsd: r.pdlCompany.costUsd,
  }));
  const pdlPerson = tally(records, PERSON_FIELDS, (r) => ({
    hits: r.pdlPerson.person,
    attempted: r.pdlPerson.attempted,
    costUsd: r.pdlPerson.costUsd,
  }));

  return {
    records: records.length,
    bySizeBand,
    verticals: [...new Set(records.map((r) => r.verticalHint))].sort(),
    claudeCompany,
    claudePerson,
    pdlCompany,
    pdlPerson,
    totalCostUsd:
      claudeCompany.totalCostUsd + pdlCompany.totalCostUsd + pdlPerson.totalCostUsd,
  };
}

/** Parse an append-only JSONL body into records, skipping blank lines. Never throws. */
export function parseRecords(jsonl: string): ExperimentRecord[] {
  const records: ExperimentRecord[] = [];
  for (const line of jsonl.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parsed = experimentRecordSchema.safeParse(JSON.parse(trimmed));
    if (parsed.success) records.push(parsed.data);
  }
  return records;
}
