import {
  setEnrichmentStatus,
  upsertContact,
  upsertPracticeFact,
} from "@/db/enrich";
import type { Database } from "@/db/types";
import { tagVertical } from "@/src/engine/resolver";
import { classifyVertical } from "@/src/engine/verticals";
import type { Meter } from "@/src/roi/cost-meter";
import { computeGaps, factsFromFindings, hasGap, type Gaps } from "./gaps";
import { runPdlPersonEnrich } from "./pdl";
import { runResearch } from "./research";
import { isEmptyFindings } from "./research-schema";
import type {
  PdlClient,
  PdlPersonResult,
  ResearchClient,
  ResearchFindings,
} from "./types";

/**
 * The Claude -> PDL enrichment waterfall (spec § Stack). Synchronous end to end:
 * PDL is a request/response API, so there is no callback and no in-flight job.
 * The practice carries `enrichment_status = 'pending'` while the (seconds-long)
 * waterfall runs — U8's pull-mode progress UI reads exactly that.
 *
 * COST DISCIPLINE — the rule this file exists to enforce: PDL is called ONLY for
 * the fields Claude left as gaps. A practice whose staff page publishes the
 * manager's name, email and LinkedIn makes ZERO PDL calls. The decision itself is
 * `computeGaps` in `./gaps.ts` — pure, and tested without a database.
 */

export interface WaterfallDeps {
  db: Database;
  research: ResearchClient;
  pdl: PdlClient;
  meter: Meter;
  /** Injected clock — provenance timestamps must be reproducible in tests. */
  now?: () => Date;
  logger?: (event: string, meta?: Record<string, unknown>) => void;
}

export interface PracticeToEnrich {
  id: string;
  name: string;
  city?: string | null;
  state?: string | null;
  websiteUrl?: string | null;
}

export interface WaterfallResult {
  practiceId: string;
  status: "enriched" | "failed";
  /** THE cost guard's observable: 0 when Claude fully resolved the contact. */
  pdlCalls: number;
  factsWritten: number;
  contactVariant: "named" | "role_only" | "none";
  vertical: string;
  reason?: string;
}

function defaultLogger(event: string, meta?: Record<string, unknown>): void {
  console.warn(event, meta ?? {});
}

function failure(
  practiceId: string,
  reason: string,
): WaterfallResult {
  return {
    practiceId,
    status: "failed",
    pdlCalls: 0,
    factsWritten: 0,
    contactVariant: "none",
    vertical: "unclassified",
    reason,
  };
}

export async function enrichPractice(
  deps: WaterfallDeps,
  practice: PracticeToEnrich,
): Promise<WaterfallResult> {
  const now = deps.now ?? (() => new Date());
  const log = deps.logger ?? defaultLogger;
  const detectedAt = now();

  // Stage 1 — Claude agentic web research. Metered inside `runResearch` (R19).
  const outcome = await runResearch(
    { client: deps.research, meter: deps.meter, practiceId: practice.id },
    {
      practiceName: practice.name,
      city: practice.city,
      state: practice.state,
      websiteUrl: practice.websiteUrl,
    },
  );

  if (!outcome.ok) {
    await setEnrichmentStatus(deps.db, practice.id, "failed");
    log("enrich.research_failed", {
      practice: practice.name,
      reason: outcome.reason,
    });
    return failure(practice.id, outcome.reason);
  }

  const { findings } = outcome;
  if (isEmptyFindings(findings)) {
    // An honest empty result is not a crash — but it is also not "enriched".
    await setEnrichmentStatus(deps.db, practice.id, "failed");
    log("enrich.empty_findings", { practice: practice.name });
    return failure(practice.id, "research returned no facts");
  }

  // Persist Claude's cited facts. Each carries its own evidence row.
  let factsWritten = 0;
  for (const fact of factsFromFindings(findings)) {
    const result = await upsertPracticeFact(deps.db, {
      practiceId: practice.id,
      provider: "claude_research",
      detectedAt,
      ...fact,
    });
    if (result.status === "written") factsWritten += 1;
  }

  // Vertical tagging: the practice's own words first, EHR only as a fallback.
  const classification = classifyVertical({
    text: [practice.name, findings.firmographics.specialty?.value]
      .filter(Boolean)
      .join(" "),
    ehr: findings.ehr?.value ?? null,
  });
  if (classification.vertical !== "unclassified") {
    await tagVertical(deps.db, practice.id, classification.vertical);
  }

  // Stage 2 — PDL, for the gaps ONLY.
  const gaps = computeGaps(findings);
  const { pdlCalls, pdlResult } = await fillGaps(deps, practice, findings, gaps, log);

  const contactVariant = await persistContact(
    deps.db,
    practice.id,
    findings,
    gaps,
    pdlResult,
  );

  await setEnrichmentStatus(deps.db, practice.id, "enriched");

  return {
    practiceId: practice.id,
    status: "enriched",
    pdlCalls,
    factsWritten,
    contactVariant,
    vertical: classification.vertical,
  };
}

async function fillGaps(
  deps: WaterfallDeps,
  practice: PracticeToEnrich,
  findings: ResearchFindings,
  gaps: Gaps,
  log: (event: string, meta?: Record<string, unknown>) => void,
): Promise<{ pdlCalls: number; pdlResult: PdlPersonResult | null }> {
  const dm = findings.decisionMaker;
  // `hasGap` is only ever true when a NAMED decision-maker exists; this narrows
  // the type for the compiler and states the invariant for the reader.
  if (!hasGap(gaps) || !dm?.name) return { pdlCalls: 0, pdlResult: null };

  try {
    const pdlResult = await runPdlPersonEnrich(
      { client: deps.pdl, meter: deps.meter, practiceId: practice.id },
      {
        fullName: dm.name.value,
        companyName: practice.name,
        role: dm.role.value,
      },
    );
    return { pdlCalls: 1, pdlResult };
  } catch (err) {
    // A 429 / timeout must not sink an otherwise-good enrichment. The contact
    // simply keeps the gap; the brief renders what it can actually cite.
    log("enrich.pdl_failed", {
      practice: practice.name,
      error: err instanceof Error ? err.message : String(err),
    });
    return { pdlCalls: 1, pdlResult: null };
  }
}

async function persistContact(
  db: Database,
  practiceId: string,
  findings: ResearchFindings,
  gaps: Gaps,
  pdlResult: PdlPersonResult | null,
): Promise<WaterfallResult["contactVariant"]> {
  const dm = findings.decisionMaker;
  if (!dm) return "none";

  // PDL may fill ONLY the fields Claude left blank. A Claude-cited value always
  // wins: it has a source URL, PDL's does not.
  const email = dm.email?.value ?? (gaps.email ? pdlResult?.workEmail : null);
  const linkedinUrl =
    dm.linkedinUrl?.value ?? (gaps.linkedinUrl ? pdlResult?.linkedinUrl : null);

  await upsertContact(db, {
    practiceId,
    role: dm.role.value,
    name: dm.name?.value ?? null,
    email: email ?? null,
    emailProvider: email ? (dm.email ? "claude_research" : "pdl") : null,
    linkedinUrl: linkedinUrl ?? null,
    linkedinProvider: linkedinUrl
      ? dm.linkedinUrl
        ? "claude_research"
        : "pdl"
      : null,
    sourceUrl: dm.role.sourceUrl,
  });

  return dm.name ? "named" : "role_only";
}
