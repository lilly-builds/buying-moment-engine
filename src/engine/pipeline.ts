import { getBrief } from "@/db/brief";
import { getPracticeEnrichmentStatus } from "@/db/enrich";
import { getPracticeWebsite, setPracticeWebsite } from "@/db/ingest";
import type { Database } from "@/db/types";
import { synthesizeBrief, type SynthesizeDeps } from "@/src/brief/synthesize";
import type { VoiceClient } from "@/src/brief/voice";
import {
  enrichPractice,
  type EscalationWiring,
  type Scraper,
  type WaterfallDeps,
} from "@/src/enrich/waterfall";
import type {
  BetterContactClient,
  ExtractClient,
  FullEnrichEmailClient,
  FullEnrichPeopleClient,
  PdlClient,
} from "@/src/enrich/types";
import type { Meter } from "@/src/roi/cost-meter";
import { resolvePractice, type PracticeCandidate } from "./resolver";

/**
 * The conductor (U5) — the missing bridge that turns a found lead into a saved, cited
 * brief. Every stage it calls is already built and tested; this chains them:
 *
 *   resolve  ->  (skip if a current brief exists)  ->  website  ->  enrich  ->  synthesize+persist
 *
 * It makes NO paid call of its own — it threads ONE injected meter into the enrichment
 * waterfall and the synthesizer, which meter their own paid calls at the call site (R19).
 * Everything external is injected (db, meter, clients, the Plan-B website resolver), so it
 * unit/integration-tests with no hidden globals.
 *
 * IDEMPOTENT + non-destructive (R17/D13): a practice that already has a current brief is
 * SKIPPED for enrichment/brief spend; an optional cross-check may still run first to
 * stack newly found signals. `resolvePractice` never duplicates or clobbers. Error
 * isolation is the BATCH driver's job (U6) — a hard throw here (a dead DB)
 * propagates so one practice's failure is logged and skipped without killing the run; the
 * two stages already fold their own soft failures into result objects rather than throwing.
 *
 * OUT OF SCOPE (next): the single-practice pull-mode API route reuses this exact conductor.
 */

/**
 * The Plan-B website search (U3), pre-bound with its fetchers + meter by the caller.
 * Receives the resolved practice `id` so the bound resolver can attribute its Places
 * spend to this practice (an honest $/brief includes the lookup cost).
 */
export type WebsiteResolver = (practice: {
  id: string;
  name: string;
  city?: string | null;
  state?: string | null;
  geoKey: string;
}) => Promise<string | null>;

export interface PipelineDeps {
  db: Database;
  /** ONE meter, threaded into both paid stages. */
  meter: Meter;
  // Enrichment-waterfall stage clients (injected — the conductor owns no socket).
  scrape: Scraper;
  extract: ExtractClient;
  /** Legacy PDL client. Omitted when coverage-first provider clients are wired. */
  pdl?: PdlClient;
  fullenrichPeople?: FullEnrichPeopleClient;
  fullenrichEmail?: FullEnrichEmailClient;
  bettercontact?: BetterContactClient;
  escalation?: EscalationWiring;
  // Synthesizer stage client.
  voice: VoiceClient;
  /** Plan B: find a website by name when none is on file. Absent → no fallback lookup. */
  resolveWebsite?: WebsiteResolver;
  /** Optional targeted pass that attaches the other signal kinds before briefing. */
  crossCheck?: (practiceId: string) => Promise<unknown>;
  /** Enrich and persist contacts only; skip brief synthesis for clean enrichment canaries. */
  enrichOnly?: boolean;
  /** Regenerate even when a current brief exists (deliberate). Default false → skip. */
  force?: boolean;
  now?: () => Date;
  logger?: (event: string, meta?: Record<string, unknown>) => void;
  /** Shared invocation guard passed into brief synthesis before each paid retry. */
  canStartVoiceAttempt?: (attempt: number) => boolean;
  /** Records queue rotation before slow or paid downstream work begins. */
  onBriefAttemptStarted?: (practiceId: string) => Promise<void>;
}

/** The lead to turn into a brief — enough to resolve, plus an optional known website. */
export interface Lead extends PracticeCandidate {
  websiteUrl?: string | null;
  enrichmentStatus?: "pending" | "enriched" | "failed";
}

export interface EnrichSummary {
  status: "enriched" | "failed";
  vertical: string;
  factsWritten: number;
  pdlCalls: number;
  providerCalls?: Record<string, number>;
  contactVariant: "named" | "role_only" | "none";
  escalated: boolean;
  reason?: string;
}

export interface BriefSummary {
  status: "generated" | "regenerated";
  briefId: string;
  attempts: number;
  zeroSignal: boolean;
  signalCount: number;
  contactVariant: "named" | "role_only" | "none";
}

export interface PipelineResult {
  practiceId: string;
  practiceName: string;
  /** true = resolved into an existing practice; false = a new one was created. */
  merged: boolean;
  /** The website enrichment read from, or null when none could be sourced. */
  website: string | null;
  /**
   * `skipped`  — a current brief already existed; nothing was spent.
   * `enriched` — enrichment ran and persisted contact/fact fields; brief synthesis was skipped.
   * `briefed`  — a brief was generated or regenerated and persisted.
   * `deferred` — enrichment completed, but the next paid brief attempt was too close to timeout.
   * `failed`   — no brief could be produced (synthesis failed at some gate).
   */
  status: "skipped" | "enriched" | "briefed" | "failed" | "deferred";
  /** Present whenever the pipeline ran past the skip guard. */
  enrich?: EnrichSummary;
  /** Present only when `status === "briefed"`. */
  brief?: BriefSummary;
  /** Skip cause, or the synthesizer's failure reason + gate. */
  reason?: string;
}

function defaultLogger(event: string, meta?: Record<string, unknown>): void {
  console.warn(event, meta ?? {});
}

/** Chain one lead through resolve → enrich → synthesize+persist. */
export async function runLeadToBrief(
  deps: PipelineDeps,
  lead: Lead,
): Promise<PipelineResult> {
  const log = deps.logger ?? defaultLogger;

  // 1 — RESOLVE. Idempotent: merges same-business spellings within a geo, else creates.
  const resolved = await resolvePractice(deps.db, {
    name: lead.name,
    geoKey: lead.geoKey,
    city: lead.city,
    state: lead.state,
    vertical: lead.vertical,
  });
  const practiceId = resolved.practiceId;
  const base = { practiceId, practiceName: lead.name, merged: resolved.merged };

  await deps.onBriefAttemptStarted?.(practiceId);

  // 2 — PROACTIVE CROSS-CHECK. Bounded to this already-qualified lead; every
  // source call is metered inside the injected function. Run before the brief
  // skip so an already-briefed practice can still gain stacked signal pills.
  if (deps.crossCheck) {
    await deps.crossCheck(practiceId);
  }

  // 3 — IDEMPOTENCY SKIP. A current brief means we are done; spend nothing. An UNREADABLE
  // brief (corrupt JSON) is NOT current — regenerate it (loud), which upsertBrief overwrites.
  if (!deps.force) {
    const existing = await getBrief(deps.db, practiceId);
    if (existing.status === "found") {
      return { ...base, website: null, status: "skipped", reason: "brief-exists" };
    }
    if (existing.status === "unreadable") {
      log("pipeline.brief_unreadable", { practiceId, reason: existing.reason });
    }
  }

  // 4 — WEBSITE (source-first, search as Plan B). Prefer the site already on file (Plan A
  // capture) or the one the lead carried; only when there is none do we pay for a search.
  let website = (await getPracticeWebsite(deps.db, practiceId)) ?? lead.websiteUrl ?? null;
  if (!website && deps.resolveWebsite) {
    const found = await deps.resolveWebsite({
      id: practiceId,
      name: lead.name,
      city: lead.city,
      state: lead.state,
      geoKey: lead.geoKey,
    });
    if (found) {
      // fill-if-null: never clobbers a site captured at the source under a race.
      website = await setPracticeWebsite(deps.db, practiceId, found);
      log("pipeline.website_found", { practiceId, website });
    }
  }

  // 5 — ENRICH. Successful enrichment is a durable checkpoint. A later invocation resumes at
  // synthesis rather than repurchasing scrape, extraction, and contact discovery.
  const enrichmentStatus =
    lead.enrichmentStatus ??
    (await getPracticeEnrichmentStatus(deps.db, practiceId));
  let enrich: EnrichSummary | undefined;
  if (enrichmentStatus !== "enriched") {
    const waterfallDeps: WaterfallDeps = {
      db: deps.db,
      scrape: deps.scrape,
      extract: deps.extract,
      pdl: deps.pdl,
      fullenrichPeople: deps.fullenrichPeople,
      fullenrichEmail: deps.fullenrichEmail,
      bettercontact: deps.bettercontact,
      meter: deps.meter,
      escalation: deps.escalation,
      now: deps.now,
      logger: deps.logger,
    };
    const enriched = await enrichPractice(waterfallDeps, {
      id: practiceId,
      name: lead.name,
      city: lead.city,
      state: lead.state,
      websiteUrl: website,
    });
    enrich = {
      status: enriched.status,
      vertical: enriched.vertical,
      factsWritten: enriched.factsWritten,
      pdlCalls: enriched.pdlCalls,
      providerCalls: enriched.providerCalls,
      contactVariant: enriched.contactVariant,
      escalated: enriched.escalated,
      reason: enriched.reason,
    };
  } else {
    log("pipeline.enrichment_reused", { practiceId });
  }

  if (deps.enrichOnly) {
    return {
      ...base,
      website,
      status: !enrich || enrich.status === "enriched" ? "enriched" : "failed",
      enrich,
      reason: enrich?.status === "failed" ? enrich.reason : undefined,
    };
  }

  // 6 — SYNTHESIZE + PERSIST (one call — synthesizeBrief upserts the brief internally).
  const synthDeps: SynthesizeDeps = {
    db: deps.db,
    client: deps.voice,
    meter: deps.meter,
    now: deps.now,
    logger: deps.logger,
    canStartVoiceAttempt: deps.canStartVoiceAttempt,
  };
  const synth = await synthesizeBrief(synthDeps, practiceId);

  if (synth.status === "deferred") {
    log("pipeline.brief_deferred", {
      practiceId,
      gate: synth.gate,
      reason: synth.reason,
    });
    return {
      ...base,
      website,
      status: "deferred",
      enrich,
      reason: enrich
        ? `enrichment checkpointed; ${synth.reason}`
        : synth.reason,
    };
  }

  if (synth.status === "failed") {
    log("pipeline.brief_failed", { practiceId, gate: synth.gate, reason: synth.reason });
    return { ...base, website, status: "failed", enrich, reason: synth.reason };
  }

  return {
    ...base,
    website,
    status: "briefed",
    enrich,
    brief: {
      status: synth.status,
      briefId: synth.briefId,
      attempts: synth.attempts,
      zeroSignal: synth.zeroSignal,
      signalCount: synth.signalCount,
      contactVariant: synth.contactVariant,
    },
  };
}
