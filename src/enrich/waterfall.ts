import {
  getContact,
  setEnrichmentStatus,
  upsertContact,
  upsertPracticeFact,
} from "@/db/enrich";
import type { Database } from "@/db/types";
import { tagVertical } from "@/src/engine/resolver";
import { classifyVertical } from "@/src/engine/verticals";
import type { Meter } from "@/src/roi/cost-meter";
import { verifyFindings, type DroppedFact } from "./citations";
import { runEscalation, type EscalationBudget } from "./escalation";
import { runExtract } from "./extract";
import {
  computeGaps,
  factsFromFindings,
  hasGap,
  normalizeLinkedinUrl,
  subtractFilled,
  type Gaps,
} from "./gaps";
import { runPdlPersonDiscover, runPdlPersonEnrich } from "./pdl";
import { isEmptyFindings } from "./research-schema";
import type { ScrapeResult } from "./scrape";
import type {
  ExtractClient,
  PdlClient,
  PdlPersonDiscoveryResult,
  PdlPersonResult,
  ResearchClient,
  ResearchFindings,
} from "./types";

/**
 * The enrichment waterfall (spec § Stack): **scrape -> extract -> verify -> PDL gap-fill
 * -> persist**. Synchronous end to end; PDL is request/response, so there is no callback
 * and no in-flight job. The practice carries `enrichment_status = 'pending'` while the
 * (seconds-long) waterfall runs — U8's pull-mode progress UI reads exactly that.
 *
 * WHAT CHANGED, AND WHY IT MATTERS HERE. Stage 1 used to be `runResearch` — Claude
 * browsing the web agentically. We never held the pages it read, so a fact's `snippet`
 * could be anything and we persisted it on the strength of the model's word. Now we
 * fetch the pages, hand the model text it cannot escape, and `verifyFindings` drops
 * every fact whose snippet is not verbatim on the page it cites. **Only verified facts
 * are persisted.** D2/R5 is enforced between the model and the database, by code.
 *
 * COST DISCIPLINE — load-bearing: PDL enrich is called ONLY for the fields the
 * extractor left as gaps AND the stored contact does not already fill. If the free path
 * found only a role, one capped Person Search may discover the person first. A practice
 * whose staff page publishes the manager's name, email and LinkedIn makes ZERO PDL
 * calls; so does a re-run with an already stored discovered contact.
 *
 * ESCALATION runs the OLD agentic mechanism, once, only when the free path failed for a
 * reason browsing could fix — and only against a run-wide spend budget. `escalationTrigger`
 * is a free, deterministic observation ("the agentic path would have run"); `escalated`
 * means $1.27 actually left the account. Splitting them lets a cohort run measure the
 * escalation rate for $0 before deciding whether to pay to learn it. See `escalation.ts`.
 */

/** Injected so the waterfall never owns a socket. Production: `scrapePractice({fetch}, url)`. */
export type Scraper = (websiteUrl: string) => Promise<ScrapeResult>;

/**
 * Client and budget travel TOGETHER, in one optional field, so that wiring the $1.27
 * agentic fallback without a spend cap is not a thing you can forget to do — it is a
 * thing you cannot express. Absent = escalation off; triggers are still recorded, free.
 */
export interface EscalationWiring {
  client: ResearchClient;
  budget: EscalationBudget;
}

export interface WaterfallDeps {
  db: Database;
  scrape: Scraper;
  extract: ExtractClient;
  pdl: PdlClient;
  meter: Meter;
  escalation?: EscalationWiring;
  /** Injected clock — provenance timestamps must be reproducible in tests. */
  now?: () => Date;
  logger?: (event: string, meta?: Record<string, unknown>) => void;
}

export interface PracticeToEnrich {
  id: string;
  name: string;
  city?: string | null;
  state?: string | null;
  /** The entry point. Without it there is nothing to scrape — see `trigger`. */
  websiteUrl?: string | null;
}

/**
 * Why the agentic fallback WOULD run. Deterministic and free to compute; U7 decides
 * whether to act on it.
 *
 * The plan names two triggers; `extract-failed` is the sub-case of "no verified facts"
 * where the model's body never became findings at all. All three share the property
 * KTD-7 demands: escalating changes both the input (search the web, not this text) and
 * the model (Sonnet 5, not Haiku). Retrying an identical call on identical input buys
 * three identical answers — that is Optiflow's Gate-4 bug, and it is not a strategy.
 */
export type EscalationTrigger =
  /** No website, or the site yielded no usable text. */
  | "thin-scrape"
  /** A billed 200 whose body never parsed into findings. */
  | "extract-failed"
  /** Extraction succeeded, nothing threw, and no fact survived citation checking. */
  | "no-verified-facts";

export interface WaterfallResult {
  practiceId: string;
  status: "enriched" | "failed";
  /** THE cost guard's observable: 0 when the extractor fully resolved the contact. */
  pdlCalls: number;
  factsWritten: number;
  /** Facts the model produced that a page we hold REFUTES. The prompt-drift early warning. */
  factsDropped: number;
  /**
   * Facts persisted WITHOUT proof, because they cite a page we never fetched. Only the
   * agentic escalation path can produce these, and they carry the assurance level this
   * refactor exists to escape. Non-zero here means "read the brief with the old eyes."
   *
   * Like `factsDropped`, this counts CITED FACTS — including the decision-maker's name and
   * role, which are not `practice_facts` rows. `factsWritten` counts rows. A contact is a
   * fact you can be wrong about too.
   */
  factsUnverifiable: number;
  pagesHeld: number;
  contactVariant: "named" | "role_only" | "none";
  vertical: string;
  /** Free and deterministic: the agentic fallback would have run. */
  escalationTrigger: EscalationTrigger | null;
  /** Did we actually buy it? $1.27 a shot. False whenever the budget said no. */
  escalated: boolean;
  reason?: string;
}

function defaultLogger(event: string, meta?: Record<string, unknown>): void {
  console.warn(event, meta ?? {});
}

const DEFAULT_DISCOVERY_ROLE = "Practice Administrator";

const CONTACT_DISCOVERY_ROLES = [
  "practice administrator",
  "practice manager",
  "office manager",
  "operations manager",
  "director of operations",
  "revenue cycle manager",
  "practice owner",
] as const;

interface DiscoveredContact {
  name: string;
  role: string;
  email: string | null;
  linkedinUrl: string | null;
  confidence: number;
}

function websiteDomain(websiteUrl: string | null | undefined): string | null {
  if (!websiteUrl) return null;
  try {
    return new URL(websiteUrl).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

interface FailureContext {
  reason: string;
  trigger: EscalationTrigger | null;
  pagesHeld?: number;
  factsDropped?: number;
  escalated?: boolean;
}

function failure(practiceId: string, ctx: FailureContext): WaterfallResult {
  return {
    practiceId,
    status: "failed",
    pdlCalls: 0,
    factsWritten: 0,
    factsDropped: ctx.factsDropped ?? 0,
    factsUnverifiable: 0,
    pagesHeld: ctx.pagesHeld ?? 0,
    contactVariant: "none",
    vertical: "unclassified",
    escalationTrigger: ctx.trigger,
    escalated: ctx.escalated ?? false,
    reason: ctx.reason,
  };
}

/** What the free, primary path learned — and, if it failed, why the paid path might help. */
interface PrimaryOutcome {
  findings: ResearchFindings | null;
  trigger: EscalationTrigger | null;
  reason: string;
  /** Whatever we hold. Handed to the escalation path so it, too, can be checked. */
  pages: Map<string, string>;
  pagesHeld: number;
  factsDropped: number;
}

export async function enrichPractice(
  deps: WaterfallDeps,
  practice: PracticeToEnrich,
): Promise<WaterfallResult> {
  const now = deps.now ?? (() => new Date());
  const log = deps.logger ?? defaultLogger;
  const detectedAt = now();

  const fail = async (ctx: FailureContext): Promise<WaterfallResult> => {
    await setEnrichmentStatus(deps.db, practice.id, "failed");
    log("enrich.failed", {
      practice: practice.name,
      reason: ctx.reason,
      escalationTrigger: ctx.trigger,
      escalated: ctx.escalated ?? false,
    });
    return failure(practice.id, ctx);
  };

  const primary = await runPrimaryPath(deps, practice, log);

  let findings = primary.findings;
  const factsDropped = primary.factsDropped;
  let factsUnverifiable = 0;
  let escalated = false;
  let reason = primary.reason;

  // Escalate ONLY when the free path failed for a reason the paid path can address, and
  // only if a budget was wired. Exactly one attempt: there is no loop here, and a second
  // thin result has nowhere to go. A SUCCESSFUL primary never escalates — that would be
  // $1.27 spent to re-learn what we already proved.
  if (findings === null && primary.trigger !== null && deps.escalation) {
    const outcome = await runEscalation(
      {
        client: deps.escalation.client,
        budget: deps.escalation.budget,
        meter: deps.meter,
        practiceId: practice.id,
      },
      {
        practiceName: practice.name,
        city: practice.city,
        state: practice.state,
        websiteUrl: practice.websiteUrl,
      },
    );

    if (outcome.attempted) {
      // `escalated` answers "did $1.27 leave the account?", not "did we try?". A THROWN
      // call is unbilled — the meter wrote nothing, and neither may the spend report.
      // Reporting $0 as $1.27 is the Westlake bug pointing the other way.
      escalated = outcome.billed;
      log("enrich.escalated", {
        practice: practice.name,
        trigger: primary.trigger,
        billed: outcome.billed,
        spent: deps.escalation.budget.spent,
        of: deps.escalation.budget.max,
      });
      if (outcome.ok) {
        findings = outcome.findings;
        // Nothing is DROPPED on this path: the agentic model read the live web, not our
        // cleaned copy, so we hold no substrate that could refute it. See `escalation.ts`.
        factsUnverifiable = outcome.unverifiable.length;
        if (outcome.unverifiable.length > 0) {
          // We paid for facts we cannot prove. Say so, every time.
          log("enrich.unverifiable_facts", {
            practice: practice.name,
            count: outcome.unverifiable.length,
            fields: outcome.unverifiable.map((f) => f.field),
          });
        }
      } else {
        reason = outcome.reason;
      }
    }
  }

  if (findings === null) {
    return fail({
      reason,
      trigger: primary.trigger,
      pagesHeld: primary.pagesHeld,
      factsDropped,
      escalated,
    });
  }

  const verified = findings;

  // Persist. Every fact here either verified against a page we hold, or (escalation only)
  // cites a page we never fetched and is counted in `factsUnverifiable`. Both are written
  // with `provider: 'claude_research'` — the `enrichment_provider` enum has no third value
  // and adding one is a migration this refactor does not own. Until it exists, a non-zero
  // `factsUnverifiable` is the only signal, and it is logged. Recorded as a known limit.
  let factsWritten = 0;
  for (const fact of factsFromFindings(verified)) {
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
    text: [practice.name, verified.firmographics.specialty?.value]
      .filter(Boolean)
      .join(" "),
    ehr: verified.ehr?.value ?? null,
  });
  if (classification.vertical !== "unclassified") {
    await tagVertical(deps.db, practice.id, classification.vertical);
  }

  // Stage 2 — PDL. Named contacts go straight to gap-fill; role-only contacts get one
  // capped discovery search, then reuse the same enrich/persist path. A re-run must not
  // re-buy an email `upsertContact` would then refuse to write. The stored row is read
  // on (practice, role), the same key it is written on.
  const decisionMaker = verified.decisionMaker;
  const claudeGaps = computeGaps(verified);
  const gaps =
    decisionMaker && hasGap(claudeGaps)
      ? subtractFilled(
          claudeGaps,
          await getContact(deps.db, practice.id, decisionMaker.role.value),
        )
      : claudeGaps;
  const { pdlCalls, pdlResult, discoveredContact } = await fillGaps(
    deps,
    practice,
    verified,
    gaps,
    factsDropped === 0,
    log,
  );

  const contactVariant = await persistContact(
    deps.db,
    practice.id,
    verified,
    gaps,
    pdlResult,
    discoveredContact,
    practice.websiteUrl ?? null,
  );

  await setEnrichmentStatus(deps.db, practice.id, "enriched");

  return {
    practiceId: practice.id,
    status: "enriched",
    pdlCalls,
    factsWritten,
    factsDropped,
    factsUnverifiable,
    pagesHeld: primary.pagesHeld,
    contactVariant,
    vertical: classification.vertical,
    // Non-null on an ENRICHED practice means the free path failed and the paid one saved
    // it. That pairing is the escalation rate U8 measures.
    escalationTrigger: primary.trigger,
    escalated,
  };
}

/**
 * Scrape -> extract -> verify. Free apart from one Haiku call. Never throws; a failure
 * comes back as `findings: null` plus the trigger (if any) that would justify paying.
 */
async function runPrimaryPath(
  deps: WaterfallDeps,
  practice: PracticeToEnrich,
  log: (event: string, meta?: Record<string, unknown>) => void,
): Promise<PrimaryOutcome> {
  const none = {
    findings: null,
    pages: new Map<string, string>(),
    pagesHeld: 0,
    factsDropped: 0,
  };

  // Without a URL there is nothing to read. The agentic path can still search by name.
  if (!practice.websiteUrl) {
    return { ...none, trigger: "thin-scrape", reason: "no website url" };
  }

  const scraped = await deps.scrape(practice.websiteUrl);
  if (scraped.pagesHeld === 0) {
    return {
      ...none,
      trigger: "thin-scrape",
      reason: `scrape yielded no usable text (${scraped.reason ?? "empty"})`,
    };
  }

  const held = { pages: scraped.pages, pagesHeld: scraped.pagesHeld };

  // ONE Haiku call over the held text. Metered inside `runExtract` (R19).
  const outcome = await runExtractGuarded(deps, practice, scraped, log);
  if (!outcome.ok) {
    return {
      ...held,
      findings: null,
      factsDropped: 0,
      // A THROWN call is unbilled and tells us nothing about the practice. Escalating on
      // it would answer a transient 429 by spending $1.27 (KTD-7).
      trigger: outcome.thrown ? null : "extract-failed",
      reason: outcome.reason,
    };
  }

  // The D2 gate. Drop every fact no held page proves, and say which.
  const { verified, dropped } = verifyFindings(outcome.findings, scraped.pages);
  if (dropped.length > 0) logDrops(log, practice.name, dropped);

  if (isEmptyFindings(verified)) {
    // Extraction SUCCEEDED and nothing threw; we simply learned nothing we can prove.
    // The old mechanism could not tell this apart from a good result.
    return {
      ...held,
      findings: null,
      factsDropped: dropped.length,
      trigger: "no-verified-facts",
      reason: "no verified facts survived citation checking",
    };
  }

  return {
    ...held,
    findings: verified,
    factsDropped: dropped.length,
    trigger: null,
    reason: "",
  };
}

type GuardedExtract =
  | { ok: true; findings: ResearchFindings }
  | { ok: false; reason: string; thrown: boolean };

/**
 * A non-2xx from Anthropic throws (correctly — it is unbilled, and the meter records
 * nothing). It must not take the whole cohort run down with it, and it must be
 * distinguishable from a BAD RESULT: only the latter is evidence about the practice.
 */
async function runExtractGuarded(
  deps: WaterfallDeps,
  practice: PracticeToEnrich,
  scraped: ScrapeResult,
  log: (event: string, meta?: Record<string, unknown>) => void,
): Promise<GuardedExtract> {
  try {
    const outcome = await runExtract(
      { client: deps.extract, meter: deps.meter, practiceId: practice.id },
      {
        practiceName: practice.name,
        city: practice.city,
        state: practice.state,
        pages: scraped.pages,
      },
    );
    return outcome.ok
      ? { ok: true, findings: outcome.findings }
      : { ok: false, reason: outcome.reason, thrown: false };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    log("enrich.extract_threw", { practice: practice.name, error: reason });
    return { ok: false, reason, thrown: true };
  }
}

/**
 * Drops are the prompt-drift early-warning signal, so they are LOUD and itemised.
 * A drop count that climbs across a cohort means the prompt moved, not that the
 * practices got shifty.
 */
function logDrops(
  log: (event: string, meta?: Record<string, unknown>) => void,
  practiceName: string,
  dropped: DroppedFact[],
): void {
  log("enrich.citation_drops", {
    practice: practiceName,
    dropped: dropped.length,
    facts: dropped.map((d) => ({
      field: d.field,
      reason: d.reason,
      // On a `value-not-in-snippet` drop the snippet is genuine and the VALUE is the
      // finding. Logging one without the other cannot explain the drop.
      value: d.value,
      sourceUrl: d.sourceUrl,
      snippet: d.snippet.slice(0, 120),
    })),
  });
}

async function fillGaps(
  deps: WaterfallDeps,
  practice: PracticeToEnrich,
  findings: ResearchFindings,
  gaps: Gaps,
  allowNoRoleDiscovery: boolean,
  log: (event: string, meta?: Record<string, unknown>) => void,
): Promise<{
  pdlCalls: number;
  pdlResult: PdlPersonResult | null;
  discoveredContact: DiscoveredContact | null;
}> {
  const dm = findings.decisionMaker;
  if (!dm) {
    if (!allowNoRoleDiscovery) {
      return { pdlCalls: 0, pdlResult: null, discoveredContact: null };
    }
    return discoverThenEnrichContact(
      deps,
      practice,
      DEFAULT_DISCOVERY_ROLE,
      log,
    );
  }

  if (!dm.name) {
    const existing = await getContact(deps.db, practice.id, dm.role.value);
    if (existing?.name) {
      const discoveredContact = {
        name: existing.name,
        role: dm.role.value,
        email: existing.email,
        linkedinUrl: existing.linkedinUrl,
        confidence: 1,
      };
      if (existing.email && existing.linkedinUrl) {
        return { pdlCalls: 0, pdlResult: null, discoveredContact };
      }
      const pdlResult = await enrichNamedContact(
        deps,
        practice,
        existing.name,
        dm.role.value,
        log,
      );
      return { pdlCalls: 1, pdlResult, discoveredContact };
    }
    return discoverThenEnrichContact(deps, practice, dm.role.value, log);
  }

  if (!hasGap(gaps)) {
    return { pdlCalls: 0, pdlResult: null, discoveredContact: null };
  }

  const pdlResult = await enrichNamedContact(
    deps,
    practice,
    dm.name.value,
    dm.role.value,
    log,
  );
  return {
    pdlCalls: 1,
    pdlResult,
    discoveredContact: null,
  };
}

async function discoverThenEnrichContact(
  deps: WaterfallDeps,
  practice: PracticeToEnrich,
  fallbackRole: string,
  log: (event: string, meta?: Record<string, unknown>) => void,
): Promise<{
  pdlCalls: number;
  pdlResult: PdlPersonResult | null;
  discoveredContact: DiscoveredContact | null;
}> {
  let discovery: PdlPersonDiscoveryResult | null = null;
  try {
    discovery = await runPdlPersonDiscover(
      { client: deps.pdl, meter: deps.meter, practiceId: practice.id },
      {
        companyName: practice.name,
        city: practice.city,
        state: practice.state,
        websiteDomain: websiteDomain(practice.websiteUrl),
        targetRoles: CONTACT_DISCOVERY_ROLES,
      },
    );
  } catch (err) {
    log("enrich.pdl_discovery_failed", {
      practice: practice.name,
      error: err instanceof Error ? err.message : String(err),
    });
    return { pdlCalls: 1, pdlResult: null, discoveredContact: null };
  }

  if (!discovery.matched || !discovery.fullName) {
    log("enrich.pdl_discovery_no_match", {
      practice: practice.name,
      confidence: discovery.confidence,
      total: discovery.total,
      billedRecords: discovery.billedRecords,
    });
    return { pdlCalls: 1, pdlResult: null, discoveredContact: null };
  }

  const discoveredRole = discovery.role ?? fallbackRole;
  const pdlResult = await enrichNamedContact(
    deps,
    practice,
    discovery.fullName,
    discoveredRole,
    log,
  );

  return {
    pdlCalls: 2,
    pdlResult,
    discoveredContact: {
      name: discovery.fullName,
      role:
        fallbackRole === DEFAULT_DISCOVERY_ROLE ? discoveredRole : fallbackRole,
      email: discovery.workEmail,
      linkedinUrl: discovery.linkedinUrl,
      confidence: discovery.confidence ?? 0,
    },
  };
}

async function enrichNamedContact(
  deps: WaterfallDeps,
  practice: PracticeToEnrich,
  fullName: string,
  role: string,
  log: (event: string, meta?: Record<string, unknown>) => void,
): Promise<PdlPersonResult | null> {
  try {
    return await runPdlPersonEnrich(
      { client: deps.pdl, meter: deps.meter, practiceId: practice.id },
      { fullName, companyName: practice.name, role },
    );
  } catch (err) {
    // A 429 / timeout must not sink an otherwise-good enrichment. The contact
    // simply keeps the gap; the brief renders what it can actually cite.
    log("enrich.pdl_failed", {
      practice: practice.name,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

async function persistContact(
  db: Database,
  practiceId: string,
  findings: ResearchFindings,
  gaps: Gaps,
  pdlResult: PdlPersonResult | null,
  discoveredContact: DiscoveredContact | null,
  fallbackSourceUrl: string | null,
): Promise<WaterfallResult["contactVariant"]> {
  const dm = findings.decisionMaker;
  if (!dm && !discoveredContact) return "none";

  // PDL may fill ONLY the fields Claude left blank. A Claude-cited value always
  // wins: it has a source URL, PDL's does not. Discovered contacts start from a
  // role-only Claude finding, so both email/linkedin are still PDL-owned gaps.
  const pdlEmail = discoveredContact
    ? (pdlResult?.workEmail ?? discoveredContact.email)
    : gaps.email
      ? pdlResult?.workEmail
      : null;
  const email = dm?.email?.value ?? pdlEmail ?? null;
  const pdlLinkedinUrl = discoveredContact
    ? (pdlResult?.linkedinUrl ?? discoveredContact.linkedinUrl)
    : gaps.linkedinUrl
      ? pdlResult?.linkedinUrl
      : null;
  // PDL's LinkedIn URL arrives scheme-less: normalize so U9's `href` is never broken.
  const linkedinUrl = normalizeLinkedinUrl(
    dm?.linkedinUrl?.value ?? pdlLinkedinUrl ?? null,
  );
  const name = dm?.name?.value ?? discoveredContact?.name ?? null;
  const role =
    discoveredContact?.role ?? dm?.role.value ?? DEFAULT_DISCOVERY_ROLE;

  await upsertContact(db, {
    practiceId,
    role,
    name,
    email: email ?? null,
    emailProvider: email ? (dm?.email ? "claude_research" : "pdl") : null,
    linkedinUrl,
    linkedinProvider: linkedinUrl
      ? dm?.linkedinUrl
        ? "claude_research"
        : "pdl"
      : null,
    sourceUrl: dm?.role.sourceUrl ?? fallbackSourceUrl,
  });

  return name ? "named" : "role_only";
}
