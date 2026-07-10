import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../setup";
import { runEngine, type PipelineClients } from "@/jobs/run-engine";
import type {
  Detector,
  DetectorContext,
  SignalCandidate,
} from "@/src/engine/detector";
import type { DetectorKind } from "@/src/ingest/validate";
import { createMeter, type CostEventRecord, type Meter } from "@/src/roi/cost-meter";
import { teeRecorder } from "@/src/enrich/experiment-run";
import { emptyScraper, FakeExtractClient, FakePdlClient } from "../enrich/doubles";
import { FakeVoiceClient } from "../brief/doubles";
import { goodVoice, NOW, seedGoldenPractice } from "../brief/fixtures/golden";
import {
  FakeClassifyClient,
  fakeDetailsFetcher,
  fakeSearchFetcher,
} from "../discovery/doubles";
import { tenantProfileSchema } from "@/src/discovery/tenants";
import type { RunDiscoveryDeps } from "@/jobs/run-discovery";
import { upsertPractice } from "@/db/ingest";
import { attachSignal, tagVertical } from "@/src/engine/resolver";
import { computeExpiresAt } from "@/src/engine/freshness";
import type { Database } from "@/db/types";

/**
 * The engine heartbeat (Thread 06) — ONE run fires every signal source, then cascades the fresh
 * cohort into briefs. These tests prove the ORCHESTRATION contract (all sources fire, metered,
 * bounded, isolated, cascade → brief); the deep behaviour of each stage is proven in its own
 * unit (run-detectors, run-discovery, pipeline-batch).
 */

const quiet = () => {};

/** A fake signal source: emits nothing, but records a metered call so R19 threading is testable. */
function fakeDetector(
  opts: { name?: string; kind?: DetectorKind; spendUsd?: number; candidates?: SignalCandidate[] } = {},
): Detector {
  return {
    name: opts.name ?? "fake-detector",
    kind: opts.kind ?? "staffing_spike",
    async detect(ctx: DetectorContext): Promise<SignalCandidate[]> {
      if (opts.spendUsd && ctx.meter) {
        await ctx.meter(
          {
            provider: "fake-jobs",
            operation: "detect",
            pipelineStep: "detectors.fake",
            practiceId: null,
            units: 1,
            unitCostUsd: opts.spendUsd,
          },
          async () => ({}),
        );
      }
      return opts.candidates ?? [];
    },
  };
}

const DISCOVERY_TENANT = tenantProfileSchema.parse({
  id: "test-tenant",
  metros: ["Austin, TX"],
  icp: [{ category: "dermatology", vertical: "dermatology" }],
  qualificationPrompt: "The reviewer describes trouble reaching the practice by phone.",
  signalKind: "phone_complaints",
  ratingThreshold: 4.0,
  rePullWindowDays: 90,
  rotation: { anchorISO: "2026-01-05T00:00:00Z", cadenceDays: 7 },
});

/** Discovery deps whose Text Search returns nothing — proves runEngine invokes runDiscovery
 *  without dragging in the full qualify chain (which run-discovery.test.ts already covers). */
function emptyDiscoveryDeps(t: TestDb, meter: Meter): RunDiscoveryDeps {
  return {
    db: t.db,
    meter,
    now: NOW,
    tenant: DISCOVERY_TENANT,
    metro: "Austin, TX",
    searchFetcher: fakeSearchFetcher({}).fetch, // unmapped category → ZERO_RESULTS
    detailsFetcher: fakeDetailsFetcher({ responses: {} }).fetch,
    classifyClient: FakeClassifyClient.byReview({}),
    logger: quiet,
  };
}

/** The enrich → synthesize bundle from the batch test: a seeded golden practice briefs with these. */
function goldenClients(over: Partial<PipelineClients> = {}): PipelineClients {
  return {
    scrape: emptyScraper().scrape,
    extract: FakeExtractClient.malformed(),
    pdl: FakePdlClient.fromFixture({ status: 404 }),
    voice: FakeVoiceClient.always(goodVoice),
    ...over,
  };
}

describe("runEngine", () => {
  let t: TestDb;
  let sink: CostEventRecord[];
  let meter: Meter;

  beforeEach(async () => {
    t = await createTestDb();
    sink = [];
    meter = createMeter(teeRecorder({ record: async () => {} }, sink));
  });
  afterEach(async () => {
    await t.close();
  });

  it("fires all signal sources, meters them (R19), and cascades the fresh cohort into a brief", async () => {
    await seedGoldenPractice(t.db); // one briefable practice at a buying moment

    const summary = await runEngine({
      db: t.db,
      meter,
      now: NOW,
      detectors: [fakeDetector({ spendUsd: 0.02 })],
      discovery: emptyDiscoveryDeps(t, meter),
      pipelineClients: goldenClients(),
      briefLimit: 5,
      logger: quiet,
    });

    // Both sources ran.
    expect("errored" in summary.sources.detectors).toBe(false);
    expect((summary.sources.detectors as { ran: true }).ran).toBe(true);
    expect("ran" in summary.sources.discovery && summary.sources.discovery.ran).toBe(true);

    // The cascade briefed the golden practice.
    expect("briefed" in summary.downstream && summary.downstream.briefed).toBe(1);

    // R19: the detector's paid call was metered through the shared meter.
    expect(sink.some((r) => r.costUsd === 0.02)).toBe(true);
  });

  it("skips discovery honestly when no discovery deps are supplied", async () => {
    const summary = await runEngine({
      db: t.db,
      meter,
      now: NOW,
      detectors: [fakeDetector()],
      discovery: null,
      pipelineClients: goldenClients(),
      briefLimit: 5,
      logger: quiet,
    });

    expect("skipped" in summary.sources.discovery && summary.sources.discovery.skipped).toBe(true);
    // Detectors still ran despite discovery being off.
    expect((summary.sources.detectors as { ran: true }).ran).toBe(true);
  });

  it("runs the free sources but skips the cascade when no enrichment clients are present", async () => {
    await seedGoldenPractice(t.db);

    const summary = await runEngine({
      db: t.db,
      meter,
      now: NOW,
      detectors: [fakeDetector()],
      discovery: null,
      pipelineClients: undefined, // no key → nothing to build a brief with
      briefLimit: 10,
      logger: quiet,
    });

    expect((summary.sources.detectors as { ran: true }).ran).toBe(true);
    expect("skipped" in summary.downstream && summary.downstream.skipped).toBe(true);
  });

  it("bounds the downstream cohort by briefLimit (the tail waits for the next run)", async () => {
    await seedGoldenPractice(t.db); // briefable practice #1 (Schlessinger, Omaha)
    // A genuinely distinct briefable practice #2 so the pull has two candidates.
    const second = await upsertPractice(t.db, {
      name: "Second Derm Clinic",
      geoKey: "austin-tx",
      city: "Austin",
      state: "TX",
    });
    await tagVertical(t.db, second.id, "dermatology");
    await attachSignal(t.db, {
      practiceId: second.id,
      kind: "phone_complaints",
      sourceUrl: "https://maps.google.com/?cid=222",
      snippet: null,
      confidence: 0.9,
      detectedAt: NOW,
      expiresAt: computeExpiresAt("phone_complaints", NOW),
      signalSource: "test",
    });

    const summary = await runEngine({
      db: t.db,
      meter,
      now: NOW,
      detectors: [],
      discovery: null,
      pipelineClients: goldenClients(),
      briefLimit: 1, // only the hottest one this run
      logger: quiet,
    });

    expect("total" in summary.downstream && summary.downstream.total).toBe(1);
  });

  it("isolates a hard STAGE failure — a throwing downstream query folds into {errored}, sources still run", async () => {
    // A db that throws on any use. detectors=[] → the detector stage never touches it; discovery=null;
    // only the downstream stage's practicesNeedingBriefs reaches it, so runStage's own catch (not the
    // batch driver's per-lead catch) is what must fold the throw into an {errored} marker.
    const throwingDb = new Proxy(
      {},
      {
        get() {
          throw new Error("db down");
        },
      },
    ) as unknown as Database;

    const summary = await runEngine({
      db: throwingDb,
      meter,
      now: NOW,
      detectors: [], // no detectors → the detector stage returns a clean empty summary, unaffected
      discovery: null,
      pipelineClients: goldenClients(),
      briefLimit: 5,
      logger: quiet,
    });

    // Only the Errored marker carries `error` (BatchSummary has a numeric `errored`), so `error`
    // is the discriminant that proves runStage caught a whole-stage throw.
    expect("error" in summary.downstream).toBe(true);
    if ("error" in summary.downstream) {
      expect(summary.downstream.error).toContain("db down");
    }
    // The detector stage still produced a normal summary — the failure did not cascade.
    expect((summary.sources.detectors as { ran: true }).ran).toBe(true);
  });

  it("isolates a per-lead failure in the cascade — the run still returns a summary", async () => {
    await seedGoldenPractice(t.db);
    const summary = await runEngine({
      db: t.db,
      meter,
      now: NOW,
      detectors: [fakeDetector()],
      discovery: null,
      pipelineClients: goldenClients({
        resolveWebsite: async () => {
          throw new Error("boom");
        },
      }),
      briefLimit: 5,
      logger: quiet,
    });

    // The batch caught the throw; runEngine surfaced a well-formed summary, not an exception.
    expect(summary.ran).toBe(true);
    expect("errored" in summary.downstream && summary.downstream.errored).toBe(1);
  });
});
