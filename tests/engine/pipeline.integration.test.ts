import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runLeadToBrief, type Lead, type PipelineDeps } from "@/src/engine/pipeline";
import { getBrief } from "@/db/brief";
import { practices } from "@/db/schema";
import { createTestDb, type TestDb } from "../setup";
import {
  emptyScraper,
  FakeExtractClient,
  FakePdlClient,
  recordingMeter,
} from "../enrich/doubles";
import { FakeVoiceClient } from "../brief/doubles";
import { goodVoice, NOW, seedGoldenPractice } from "../brief/fixtures/golden";

/**
 * U5 integration — the full chain end to end against the REAL built stages (resolver,
 * enrichment waterfall, synthesizer, brief persistence) with only external I/O faked.
 * Proves the conductor produces a persisted, schema-valid, citation-closed brief and is
 * idempotent + non-destructive (R17) — the pipeline's central promise.
 */

const quiet = () => {};
const GOLDEN_LEAD: Lead = {
  name: "Schlessinger MD Dermatology",
  geoKey: "omaha-ne",
  city: "Omaha",
  state: "NE",
};

function baseDeps(t: TestDb, over: Partial<PipelineDeps> = {}) {
  const meter = recordingMeter();
  const deps: PipelineDeps = {
    db: t.db,
    meter: meter.meter,
    scrape: emptyScraper().scrape,
    extract: FakeExtractClient.malformed(),
    pdl: FakePdlClient.fromFixture({ status: 404 }),
    voice: FakeVoiceClient.always(goodVoice),
    now: () => NOW,
    logger: quiet,
    ...over,
  };
  return { deps, rows: meter.rows };
}

describe("runLeadToBrief — full chain", () => {
  let t: TestDb;
  beforeEach(async () => {
    t = await createTestDb();
  });
  afterEach(async () => {
    await t.close();
  });

  it("produces a persisted, schema-valid, fully-cited brief from a real practice", async () => {
    await seedGoldenPractice(t.db);
    const { deps } = baseDeps(t);

    const result = await runLeadToBrief(deps, GOLDEN_LEAD);
    expect(result.status).toBe("briefed");
    expect(result.merged).toBe(true); // resolved into the seeded practice, not a new one
    expect(result.brief).toMatchObject({ status: "generated", zeroSignal: false, signalCount: 2 });

    // Schema-valid: getBrief re-parses both tiers on the way out; the synthesizer only
    // persists a brief that passed shape + citation-closure + truth, so `found` here
    // means a fully-cited brief actually landed.
    const stored = await getBrief(t.db, result.practiceId);
    expect(stored.status).toBe("found");
    if (stored.status === "found") {
      expect(stored.brief.voice.sequence.touches).toHaveLength(3);
      expect(stored.brief.voice.sequence.namedCta).toBeTruthy();
    }
  });

  it("is idempotent — a second run skips, spends nothing, and never duplicates the practice", async () => {
    await seedGoldenPractice(t.db);
    const first = await runLeadToBrief(baseDeps(t).deps, GOLDEN_LEAD);
    expect(first.status).toBe("briefed");

    const scraper = emptyScraper();
    const resolveWebsite = vi.fn(async () => "https://should-not-run.example");
    const { deps, rows } = baseDeps(t, { scrape: scraper.scrape, resolveWebsite });
    const second = await runLeadToBrief(deps, GOLDEN_LEAD);

    expect(second.status).toBe("skipped");
    expect(second.reason).toBe("brief-exists");
    expect(scraper.calls).toEqual([]); // no enrich
    expect(resolveWebsite).not.toHaveBeenCalled(); // no website search
    expect(rows).toEqual([]); // no paid spend on a skip

    const named = (await t.db.select().from(practices)).filter((p) => p.name === GOLDEN_LEAD.name);
    expect(named).toHaveLength(1); // no duplicate row
  });

  it("force regenerates an existing brief", async () => {
    await seedGoldenPractice(t.db);
    await runLeadToBrief(baseDeps(t).deps, GOLDEN_LEAD);

    const { deps } = baseDeps(t, { force: true });
    const result = await runLeadToBrief(deps, GOLDEN_LEAD);
    expect(result.status).toBe("briefed");
    expect(result.brief?.status).toBe("regenerated");
  });
});
