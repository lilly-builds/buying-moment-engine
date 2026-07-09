import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Database } from "./types";
import { upsertPractice, upsertSignal } from "./ingest";
import {
  briefs,
  contacts,
  costEvents,
  crmLinks,
  evidence,
  feedback,
  roiEvents,
  sequences,
} from "./schema";
import { BRIEF_SCHEMA_VERSION } from "@/src/brief/config";
import type { DetectorKind } from "@/src/ingest/validate";
import type { PackVertical } from "@/src/packs";
import { demoBrief } from "@/app/styleguide/demo-fixtures";

/**
 * Idempotent, non-destructive DEMO seed (Lilly's call, 2026-07-09) — the path that fills
 * the empty tables so the real routes (`/`, `/practice/{id}`, `/scoreboard`) render without
 * spending a cent of API budget. NOT the real pipeline.
 *
 * The contract (D13 / R17):
 *   - **Idempotent.** Every write is `ON CONFLICT DO NOTHING` on a natural key (or a
 *     deterministic seed id), so a second run is a no-op, not a duplicate.
 *   - **Non-destructive.** It only ADDS clearly-demo practices (fictional names, `example`
 *     source URLs, `demo:` geo keys). It never touches the 5 real practices: they have
 *     different `(normalized_name, geo_key)` pairs, so `upsertPractice` cannot collide.
 *   - **Provenance on every fact** (source URL + detected-at); **business data only, no PHI.**
 *
 * What it populates: one fully-briefed hero (`Cedarline`, reusing the approved `demoBrief`
 * so the real brief route renders pixel-identical to `/styleguide/brief`), five more
 * fresh-signal practices for the feed, and a modest, honestly-sized funnel of
 * `roi_events` / `cost_events` / `feedback` / `crm_links` for the scoreboard. Every number
 * the scoreboard shows is aggregated from these rows — nothing is hardcoded in the view.
 */

const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (now: Date, n: number) => new Date(now.getTime() - n * DAY);
const daysAhead = (now: Date, n: number) => new Date(now.getTime() + n * DAY);

/** A stable, valid UUID derived from a seed key, so re-runs address the same row. */
function seedId(key: string): string {
  const h = createHash("sha1").update(`bme-demo:${key}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

const AE_EMAIL = "ae@demo.eliseai.test";
const SIGNAL_SOURCE_URL: Record<DetectorKind, string> = {
  staffing_spike: "https://www.indeed.com/jobs?q=patient+coordinator",
  phone_complaints: "https://www.google.com/maps/search/clinic+reviews",
  growth_events: "https://www.beckersasc.com/",
  regulation: "https://www.example.com/regulation",
};

/** The funnel/activity/cost/verdict fields `seedFunnel` writes — shared by every practice. */
interface FunnelSpec {
  key: string;
  vertical: PackVertical;
  cohort: "buying_moment" | "cold";
  meeting: boolean;
  deal: boolean;
  cycleDays?: number;
  hours: number;
  feedback?: { thumb: "up" | "down"; reason?: string };
  costUsd: number;
}

interface PracticeSeed extends FunnelSpec {
  name: string;
  city: string;
  state: string;
  /** Its buying-moment signal kind — the feed pill and the conversion attribution. */
  signalKind: DetectorKind;
  /** Fresh signal → shows in the feed; expired → out of the feed but still attributable. */
  fresh: boolean;
}

/**
 * The funnel, authored so the aggregate numbers are honest and readable (the integration
 * test asserts the exact totals). Including the Cedarline hero: 18 leads → 10 meetings →
 * 4 deals; the three `cold` rows convert far worse than the buying-moment rows (the point
 * of the "big test").
 */
const PRACTICE_SEEDS: PracticeSeed[] = [
  // ── Feed practices (fresh signals) — no brief yet, so they render the honest empty state ──
  { key: "harborlight", name: "Harborlight Women's Health", city: "Portland", state: "OR", vertical: "womens_health", signalKind: "staffing_spike", fresh: true, cohort: "buying_moment", meeting: true, deal: false, cycleDays: 44, hours: 9, feedback: { thumb: "up" }, costUsd: 4.6 },
  { key: "summit-ortho", name: "Summit Orthopedic Partners", city: "Denver", state: "CO", vertical: "orthopedics", signalKind: "phone_complaints", fresh: true, cohort: "buying_moment", meeting: true, deal: false, cycleDays: 51, hours: 8, feedback: { thumb: "up" }, costUsd: 4.4 },
  { key: "clearview-eye", name: "Clearview Eye Associates", city: "San Jose", state: "CA", vertical: "ophthalmology", signalKind: "staffing_spike", fresh: true, cohort: "buying_moment", meeting: false, deal: false, hours: 6, costUsd: 4.1 },
  { key: "riverside-womens", name: "Riverside Women's Care", city: "Sacramento", state: "CA", vertical: "womens_health", signalKind: "growth_events", fresh: true, cohort: "buying_moment", meeting: false, deal: false, hours: 5, feedback: { thumb: "down", reason: "already_customer" }, costUsd: 4.0 },
  { key: "meridian-eye", name: "Meridian Eye Care Associates", city: "Columbus", state: "OH", vertical: "ophthalmology", signalKind: "growth_events", fresh: true, cohort: "buying_moment", meeting: false, deal: false, hours: 5, feedback: { thumb: "down", reason: "bad_timing" }, costUsd: 3.9 },

  // ── Funnel-only practices (expired signals) — populate the scoreboard, stay out of the feed ──
  { key: "d1", name: "Fair Oaks Dermatology", city: "Austin", state: "TX", vertical: "dermatology", signalKind: "staffing_spike", fresh: false, cohort: "buying_moment", meeting: true, deal: true, cycleDays: 28, hours: 11, feedback: { thumb: "up" }, costUsd: 5.2 },
  { key: "d2", name: "Stonebridge Skin Clinic", city: "Dallas", state: "TX", vertical: "dermatology", signalKind: "phone_complaints", fresh: false, cohort: "buying_moment", meeting: true, deal: false, cycleDays: 33, hours: 9, costUsd: 4.7 },
  { key: "d3", name: "Highland Dermatology Group", city: "Nashville", state: "TN", vertical: "dermatology", signalKind: "growth_events", fresh: false, cohort: "buying_moment", meeting: false, deal: false, hours: 6, costUsd: 4.2 },
  { key: "w1", name: "Cedar Ridge Women's Clinic", city: "Boise", state: "ID", vertical: "womens_health", signalKind: "staffing_spike", fresh: false, cohort: "buying_moment", meeting: true, deal: true, cycleDays: 41, hours: 10, feedback: { thumb: "up" }, costUsd: 5.0 },
  { key: "w2", name: "Bayview OB-GYN", city: "Tampa", state: "FL", vertical: "womens_health", signalKind: "phone_complaints", fresh: false, cohort: "cold", meeting: true, deal: false, cycleDays: 47, hours: 7, costUsd: 4.5 },
  { key: "w3", name: "Grandview Women's Health", city: "Kansas City", state: "MO", vertical: "womens_health", signalKind: "growth_events", fresh: false, cohort: "buying_moment", meeting: false, deal: false, hours: 5, feedback: { thumb: "down", reason: "too_small" }, costUsd: 4.0 },
  { key: "o1", name: "Pinecrest Eye Center", city: "Charlotte", state: "NC", vertical: "ophthalmology", signalKind: "staffing_spike", fresh: false, cohort: "buying_moment", meeting: true, deal: false, cycleDays: 46, hours: 8, costUsd: 4.6 },
  { key: "o2", name: "Ironwood Vision", city: "Phoenix", state: "AZ", vertical: "ophthalmology", signalKind: "phone_complaints", fresh: false, cohort: "cold", meeting: false, deal: false, hours: 4, feedback: { thumb: "down", reason: "wrong_specialty" }, costUsd: 3.8 },
  { key: "o3", name: "Meadowbrook Eye Associates", city: "Cleveland", state: "OH", vertical: "ophthalmology", signalKind: "growth_events", fresh: false, cohort: "buying_moment", meeting: false, deal: false, hours: 4, costUsd: 3.8 },
  { key: "r1", name: "Northgate Orthopedics", city: "Seattle", state: "WA", vertical: "orthopedics", signalKind: "staffing_spike", fresh: false, cohort: "buying_moment", meeting: true, deal: true, cycleDays: 52, hours: 10, feedback: { thumb: "up" }, costUsd: 5.1 },
  { key: "r2", name: "Lakeshore Bone & Joint", city: "Chicago", state: "IL", vertical: "orthopedics", signalKind: "phone_complaints", fresh: false, cohort: "buying_moment", meeting: true, deal: false, cycleDays: 58, hours: 8, costUsd: 4.7 },
  { key: "r3", name: "Old Mill Orthopedic Center", city: "Minneapolis", state: "MN", vertical: "orthopedics", signalKind: "growth_events", fresh: false, cohort: "cold", meeting: false, deal: false, hours: 5, costUsd: 4.1 },
];

/** Idempotent evidence insert (explicit id → re-run is a no-op). */
async function seedEvidence(
  db: Database,
  e: { id: string; sourceUrl: string; snippet: string | null; confidence: number | null; detectedAt: Date },
): Promise<void> {
  await db
    .insert(evidence)
    .values({
      id: e.id,
      sourceUrl: e.sourceUrl,
      snippet: e.snippet,
      confidence: e.confidence !== null ? String(e.confidence) : null,
      detectedAt: e.detectedAt,
    })
    .onConflictDoNothing({ target: evidence.id });
}

/** The tool's funnel + activity events, cost, cycle, and AE verdict for one practice. */
async function seedFunnel(db: Database, now: Date, p: FunnelSpec, practiceId: string): Promise<void> {
  await db
    .insert(roiEvents)
    .values({
      id: seedId(`roi:${p.key}:lead_pushed`),
      eventType: "lead_pushed",
      practiceId,
      vertical: p.vertical,
      payload: { cohort: p.cohort, source: "demo-seed" },
    })
    .onConflictDoNothing({ target: roiEvents.id });

  if (p.meeting) {
    await db
      .insert(roiEvents)
      .values({
        id: seedId(`roi:${p.key}:meeting_booked`),
        eventType: "meeting_booked",
        practiceId,
        payload: { stage: "appointmentscheduled", cycleTimeDays: p.cycleDays ?? null },
      })
      .onConflictDoNothing({ target: roiEvents.id });
  }

  if (p.deal) {
    await db
      .insert(roiEvents)
      .values({
        id: seedId(`roi:${p.key}:deal_won`),
        eventType: "deal_won",
        practiceId,
        payload: { stage: "closedwon", cycleTimeDays: p.cycleDays ?? null },
      })
      .onConflictDoNothing({ target: roiEvents.id });
  }

  await db
    .insert(roiEvents)
    .values({
      id: seedId(`roi:${p.key}:time_saved`),
      eventType: "time_saved_estimate",
      practiceId,
      vertical: p.vertical,
      payload: { hours: p.hours },
    })
    .onConflictDoNothing({ target: roiEvents.id });

  // One metered spend row (R19) — what makes CAC / cost-per-meeting a real number.
  await db
    .insert(costEvents)
    .values({
      id: seedId(`cost:${p.key}:enrich`),
      provider: "anthropic",
      operation: "messages",
      pipelineStep: "enrich.research",
      practiceId,
      units: "1",
      unitCostUsd: String(p.costUsd),
      costUsd: String(p.costUsd),
      meta: { seed: "demo" },
    })
    .onConflictDoNothing({ target: costEvents.id });

  await db
    .insert(crmLinks)
    .values({
      practiceId,
      provider: "hubspot",
      stage: p.deal ? "closedwon" : p.meeting ? "appointmentscheduled" : "qualifiedtobuy",
      cycleTimeDays: p.cycleDays !== undefined ? String(p.cycleDays) : null,
      syncedAt: now,
    })
    .onConflictDoNothing({ target: [crmLinks.practiceId, crmLinks.provider] });

  if (p.feedback) {
    await db
      .insert(feedback)
      .values({
        practiceId,
        aeEmail: AE_EMAIL,
        thumb: p.feedback.thumb,
        reason: p.feedback.reason as never,
      })
      .onConflictDoNothing({ target: [feedback.practiceId, feedback.aeEmail] });
  }
}

/** The Cedarline hero — the one fully-briefed practice, reusing the approved `demoBrief`. */
async function seedCedarline(db: Database, now: Date): Promise<void> {
  const brief = demoBrief(now);
  const practice = await upsertPractice(db, {
    name: brief.factual.practiceName,
    geoKey: "demo:cedarline-austin-tx",
    city: brief.factual.city,
    state: brief.factual.state,
    vertical: "dermatology",
  });

  // The three fired signals, straight off the approved brief, so the live buying-moment
  // view the real route computes matches the stored fingerprint (a fresh, non-stale card).
  for (const s of brief.live.firedSignals) {
    await seedEvidence(db, {
      id: s.evidenceId,
      sourceUrl: s.sourceUrl,
      snippet: null,
      confidence: s.confidence,
      detectedAt: s.detectedAt,
    });
    await upsertSignal(db, {
      practiceId: practice.id,
      kind: s.kind,
      evidenceId: s.evidenceId,
      confidence: s.confidence !== null ? String(s.confidence) : null,
      detectedAt: s.detectedAt,
      expiresAt: s.expiresAt,
      signalSource: s.signalSource,
    });
  }

  // The stored brief. DO NOTHING on conflict: never clobber a brief that already exists.
  await db
    .insert(briefs)
    .values({
      practiceId: practice.id,
      factual: brief.factual,
      voice: brief.voice,
      schemaVersion: BRIEF_SCHEMA_VERSION,
      generatedAt: now,
    })
    .onConflictDoNothing({ target: briefs.practiceId });

  const [briefRow] = await db
    .select({ id: briefs.id })
    .from(briefs)
    .where(eq(briefs.practiceId, practice.id))
    .limit(1);

  const c = brief.factual.contact;
  if (c && c.variant === "named") {
    await db
      .insert(contacts)
      .values({
        id: seedId("contact:cedarline"),
        practiceId: practice.id,
        name: c.name,
        role: c.role,
        email: c.email,
        emailProvider: c.emailProvider,
        linkedinUrl: c.linkedinUrl,
        bestChannel: c.bestChannel,
        personalizationSnippet: brief.voice.personalizationSnippet,
        sourceUrl: c.sourceUrl,
      })
      .onConflictDoNothing({ target: contacts.id });
  }

  // The 3-touch sequence — needed for the scoreboard's "messages to land a meeting".
  if (briefRow) {
    for (const touch of brief.voice.sequence.touches) {
      await db
        .insert(sequences)
        .values({
          briefId: briefRow.id,
          touchNumber: touch.touchNumber,
          channel: touch.channel,
          body: touch.body,
          cta: brief.voice.sequence.namedCta,
        })
        .onConflictDoNothing({ target: [sequences.briefId, sequences.touchNumber] });
    }
  }

  await seedFunnel(db, now, {
    key: "cedarline",
    vertical: "dermatology",
    cohort: "buying_moment",
    meeting: true,
    deal: true,
    cycleDays: 31,
    hours: 14,
    feedback: { thumb: "up" },
    costUsd: 6.4,
  }, practice.id);
}

/**
 * Seed the demo data. Pure w.r.t. the clock (`now` injected) so the integration test is
 * deterministic and a re-run writes nothing new.
 */
export async function seedDemo(db: Database, now: Date = new Date()): Promise<void> {
  await seedCedarline(db, now);

  for (const p of PRACTICE_SEEDS) {
    const practice = await upsertPractice(db, {
      name: p.name,
      geoKey: `demo:${p.key}`,
      city: p.city,
      state: p.state,
      vertical: p.vertical,
    });

    // Fresh signal → in the feed; expired → out of the feed but still attributable to a
    // kind for the "which signals convert" panel.
    const detectedAt = p.fresh ? daysAgo(now, 2) : daysAgo(now, 120);
    const expiresAt = p.fresh ? daysAhead(now, 28) : daysAgo(now, 90);
    const evidenceId = seedId(`ev:${p.key}:${p.signalKind}`);
    await seedEvidence(db, {
      id: evidenceId,
      sourceUrl: SIGNAL_SOURCE_URL[p.signalKind],
      snippet: null,
      confidence: 0.8,
      detectedAt,
    });
    await upsertSignal(db, {
      practiceId: practice.id,
      kind: p.signalKind,
      evidenceId,
      confidence: "0.8",
      detectedAt,
      expiresAt,
      signalSource: p.signalKind,
    });

    await seedFunnel(db, now, p, practice.id);
  }
}
