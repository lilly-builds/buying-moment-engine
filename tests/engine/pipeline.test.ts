import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runLeadToBrief, type Lead, type PipelineDeps } from "@/src/engine/pipeline";
import { getPracticeWebsite, setPracticeWebsite } from "@/db/ingest";
import { createTestDb, type TestDb } from "../setup";
import {
  emptyScraper,
  fakeScraper,
  FakeExtractClient,
  FakePdlClient,
  recordingMeter,
} from "../enrich/doubles";
import { FakeVoiceClient } from "../brief/doubles";
import { goodVoice, NOW, seedGoldenPractice } from "../brief/fixtures/golden";

/**
 * U5 orchestration branches — the conductor's decisions (website source-first, enrich
 * non-fatal, one meter threaded to both paid stages), against the REAL built stages with
 * only external I/O faked. The full happy chain + idempotency live in the integration test.
 */

const quiet = () => {};
/** A Lead that resolves to the seeded golden practice (self-match, similarity 1.0). */
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

describe("runLeadToBrief — orchestration", () => {
  let t: TestDb;
  beforeEach(async () => {
    t = await createTestDb();
  });
  afterEach(async () => {
    await t.close();
  });

  it("uses a website already on file and does NOT search (source-first)", async () => {
    const ids = await seedGoldenPractice(t.db);
    await setPracticeWebsite(t.db, ids.practiceId, "https://onfile.example");
    const scraper = emptyScraper();
    const resolveWebsite = vi.fn(async () => "https://searched.example");
    const { deps } = baseDeps(t, { scrape: scraper.scrape, resolveWebsite });

    const result = await runLeadToBrief(deps, GOLDEN_LEAD);
    expect(resolveWebsite).not.toHaveBeenCalled();
    expect(scraper.calls).toEqual(["https://onfile.example"]);
    expect(result.website).toBe("https://onfile.example");
  });

  it("searches (Plan B) and persists a website when none is on file", async () => {
    const ids = await seedGoldenPractice(t.db);
    const scraper = emptyScraper();
    const resolveWebsite = vi.fn(async () => "https://found.example");
    const { deps } = baseDeps(t, { scrape: scraper.scrape, resolveWebsite });

    const result = await runLeadToBrief(deps, GOLDEN_LEAD);
    expect(resolveWebsite).toHaveBeenCalledOnce();
    expect(scraper.calls).toEqual(["https://found.example"]);
    expect(result.website).toBe("https://found.example");
    expect(await getPracticeWebsite(t.db, ids.practiceId)).toBe("https://found.example");
  });

  it("enriches with no website when none is available and none can be searched", async () => {
    await seedGoldenPractice(t.db);
    const scraper = emptyScraper();
    const { deps } = baseDeps(t, { scrape: scraper.scrape }); // no resolveWebsite
    const result = await runLeadToBrief(deps, GOLDEN_LEAD);
    expect(result.website).toBeNull();
    // enrichment short-circuits before scraping when there is no url.
    expect(scraper.calls).toEqual([]);
    expect(result.status).toBe("briefed");
  });

  it("still produces a brief when enrichment fails (enrich failure is non-fatal)", async () => {
    await seedGoldenPractice(t.db);
    const { deps } = baseDeps(t); // emptyScraper → thin scrape → enrich status:"failed"
    const result = await runLeadToBrief(deps, GOLDEN_LEAD);
    expect(result.enrich?.status).toBe("failed");
    expect(result.status).toBe("briefed");
    expect(result.brief?.briefId).toBeTruthy();
  });

  it("threads the one meter into BOTH the enrich and synth paid calls (R19)", async () => {
    const ids = await seedGoldenPractice(t.db);
    // A website on file so enrichment actually scrapes → extracts (the paid call we meter).
    await setPracticeWebsite(t.db, ids.practiceId, "https://site.example");
    const pages = new Map([
      ["https://site.example/about", "Schlessinger MD is a dermatology practice in Omaha."],
    ]);
    const { deps, rows } = baseDeps(t, {
      scrape: fakeScraper(pages).scrape,
      extract: FakeExtractClient.malformed(), // billed 200 → metered even though it won't parse
    });
    await runLeadToBrief(deps, GOLDEN_LEAD);
    const steps = rows.map((r) => r.pipelineStep);
    expect(steps).toContain("enrich.extract");
    expect(steps).toContain("brief.voice");
  });
});
