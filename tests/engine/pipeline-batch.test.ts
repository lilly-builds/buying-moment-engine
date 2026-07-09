import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runPipelineBatch } from "@/src/engine/pipeline-batch";
import type { Lead, PipelineDeps } from "@/src/engine/pipeline";
import { createMeter, type CostEventRecord } from "@/src/roi/cost-meter";
import { teeRecorder, spendFor } from "@/src/enrich/experiment-run";
import { createTestDb, type TestDb } from "../setup";
import { emptyScraper, FakeExtractClient, FakePdlClient } from "../enrich/doubles";
import { FakeVoiceClient } from "../brief/doubles";
import { goodVoice, NOW, seedGoldenPractice } from "../brief/fixtures/golden";

/**
 * U6 batch driver — error isolation (one lead's throw never kills the run), honest rollup
 * counts, and per-practice spend attribution from the metered rows (what the seeding script's
 * "$/brief" line reads).
 */

const quiet = () => {};
const GOLDEN_LEAD: Lead = { name: "Schlessinger MD Dermatology", geoKey: "omaha-ne", city: "Omaha", state: "NE" };

describe("runPipelineBatch", () => {
  let t: TestDb;
  beforeEach(async () => {
    t = await createTestDb();
  });
  afterEach(async () => {
    await t.close();
  });

  function deps(sink: CostEventRecord[], over: Partial<PipelineDeps> = {}): PipelineDeps {
    return {
      db: t.db,
      meter: createMeter(teeRecorder({ record: async () => {} }, sink)),
      scrape: emptyScraper().scrape,
      extract: FakeExtractClient.malformed(),
      pdl: FakePdlClient.fromFixture({ status: 404 }),
      voice: FakeVoiceClient.always(goodVoice),
      now: () => NOW,
      logger: quiet,
      ...over,
    };
  }

  it("isolates a throwing lead — the rest of the batch still completes", async () => {
    await seedGoldenPractice(t.db); // makes GOLDEN_LEAD briefable
    const sink: CostEventRecord[] = [];
    // A resolveWebsite that throws for one specific lead — the only stage the conductor
    // does not itself guard, so it surfaces as a hard throw the BATCH must isolate.
    const resolveWebsite = async (p: { name: string }) => {
      if (p.name === "Boom Clinic") throw new Error("boom");
      return null;
    };

    const leads: Lead[] = [
      GOLDEN_LEAD, // → briefed
      { name: "Boom Clinic", geoKey: "reno-nv" }, // → throws in resolveWebsite → errored
      { name: "Fresh Unclassified Clinic", geoKey: "boise-id" }, // → no pack → synth input gate → failed
    ];

    const summary = await runPipelineBatch(deps(sink, { resolveWebsite }), leads, quiet);

    expect(summary.total).toBe(3);
    expect(summary.briefed).toBe(1);
    expect(summary.errored).toBe(1);
    expect(summary.failed).toBe(1); // the lead AFTER the throw still ran
    const errored = summary.items.find((i) => i.name === "Boom Clinic");
    expect(errored?.status).toBe("errored");
    expect(errored?.error).toContain("boom");
  });

  it("tallies briefed/skipped correctly across a re-run (idempotent)", async () => {
    await seedGoldenPractice(t.db);
    const sink: CostEventRecord[] = [];
    const first = await runPipelineBatch(deps(sink), [GOLDEN_LEAD], quiet);
    expect(first.briefed).toBe(1);
    const second = await runPipelineBatch(deps(sink), [GOLDEN_LEAD], quiet);
    expect(second.skipped).toBe(1);
    expect(second.briefed).toBe(0);
  });

  it("attributes per-practice spend from the metered rows (the $/brief line)", async () => {
    await seedGoldenPractice(t.db);
    const sink: CostEventRecord[] = [];
    const summary = await runPipelineBatch(deps(sink), [GOLDEN_LEAD], quiet);
    const briefed = summary.items[0];
    expect(briefed.status).toBe("briefed");
    // The voice (synth) call is metered against this practice → spend attributable by id.
    const spend = spendFor(sink.filter((r) => r.practiceId === briefed.practiceId), "anthropic");
    expect(spend).toBeGreaterThan(0);
  });
});
