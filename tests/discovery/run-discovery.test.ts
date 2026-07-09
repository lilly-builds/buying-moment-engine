import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../setup";
import {
  FakeClassifyClient,
  fakeDetailsFetcher,
  fakeSearchFetcher,
  recordingMeter,
  type ReviewVerdict,
} from "./doubles";
import { runDiscovery, type RunDiscoveryDeps } from "@/jobs/run-discovery";
import { tenantProfileSchema } from "@/src/discovery/tenants";
import { upsertDiscoveryCandidate } from "@/db/discovery";
import { upsertPractice } from "@/db/ingest";
import { attachSignal } from "@/src/engine/resolver";
import { computeExpiresAt } from "@/src/engine/freshness";
import { feedPractices } from "@/db/queries";
import { discoveryCandidates } from "@/db/schema";
import { evidence, signals } from "@/db/schema";
import { eq } from "drizzle-orm";

const NOW = new Date("2026-07-09T00:00:00Z");

const TENANT = tenantProfileSchema.parse({
  id: "test-tenant",
  metros: ["Austin, TX"],
  icp: [{ category: "dermatology", vertical: "dermatology" }],
  qualificationPrompt: "The reviewer describes trouble reaching the practice by phone.",
  signalKind: "phone_complaints",
  ratingThreshold: 4.0,
  rePullWindowDays: 90,
  rotation: { anchorISO: "2026-01-05T00:00:00Z", cadenceDays: 7 },
});

const REVIEW_PAIN = "I can't get through on the phone, always on hold for 20 minutes.";
const REVIEW_HAPPY = "Lovely staff, quick visit, highly recommend.";

const QUALIFY: ReviewVerdict = { qualifies: true, confidence: 0.88, category: "cannot-get-through" };

function searchResponse(
  places: Array<{ place_id: string; name: string; rating?: number; user_ratings_total?: number }>,
): unknown {
  return { status: "OK", results: places };
}

function detailsResponse(
  placeId: string,
  name: string,
  reviewTexts: string[],
  url?: string,
): unknown {
  return {
    status: "OK",
    result: { place_id: placeId, name, url, reviews: reviewTexts.map((text) => ({ text })) },
  };
}

/** Two derm places: a low-rated one (passes the funnel) and a high-rated one (dropped). */
const SEARCH_TWO_PLACES = searchResponse([
  { place_id: "ChIJlow", name: "Rundberg Dermatology", rating: 2.8, user_ratings_total: 176 },
  { place_id: "ChIJhigh", name: "Bright Skin Dermatology", rating: 4.9, user_ratings_total: 412 },
]);

/** Details for the low-rated place: one phone-pain review + one happy review. */
const DETAILS_LOW_QUALIFIES = detailsResponse(
  "ChIJlow",
  "Rundberg Dermatology",
  [REVIEW_PAIN, REVIEW_HAPPY],
  "https://maps.google.com/?cid=111",
);

function baseDeps(t: TestDb, overrides: Partial<RunDiscoveryDeps> = {}): RunDiscoveryDeps {
  const search = fakeSearchFetcher({ dermatology: SEARCH_TWO_PLACES });
  const details = fakeDetailsFetcher({ responses: { ChIJlow: DETAILS_LOW_QUALIFIES } });
  return {
    db: t.db,
    meter: recordingMeter().meter,
    now: NOW,
    tenant: TENANT,
    metro: "Austin, TX",
    searchFetcher: search.fetch,
    detailsFetcher: details.fetch,
    classifyClient: FakeClassifyClient.byReview({ [REVIEW_PAIN]: QUALIFY }),
    logger: () => {},
    ...overrides,
  };
}

describe("runDiscovery — end to end", () => {
  let t: TestDb;
  beforeEach(async () => {
    t = await createTestDb();
  });
  afterEach(async () => {
    await t.close();
  });

  it("qualifies the low-rated place, lands it on the feed, archives both places (R3/R4)", async () => {
    const summary = await runDiscovery(baseDeps(t));

    expect(summary.enumerated).toBe(2);
    expect(summary.funneledOut).toBe(1); // the 4.9 place
    expect(summary.qualified).toBe(1);
    expect(summary.qualifiedPlaces[0]).toMatchObject({
      placeId: "ChIJlow",
      category: "cannot-get-through",
      confidence: 0.88,
    });

    // It appears on the feed with the tenant's signal kind.
    const feed = await feedPractices(t.db, NOW);
    expect(feed).toHaveLength(1);
    expect(feed[0].name).toBe("Rundberg Dermatology");
    expect(feed[0].vertical).toBe("dermatology");
    expect(feed[0].signals.map((s) => s.kind)).toEqual(["phone_complaints"]);

    // Both places have discovery_candidates rows with the right verdicts.
    const rows = await t.db.select().from(discoveryCandidates);
    const byId = Object.fromEntries(rows.map((r) => [r.placeId, r]));
    expect(byId.ChIJlow.lastVerdict).toBe("qualified");
    expect(byId.ChIJlow.qualifiedKind).toBe("phone_complaints");
    expect(byId.ChIJhigh.lastVerdict).toBe("not-targeted");
  });

  it("stacks onto an existing Adzuna practice by fuzzy name -> a 2-signal feed row (R4)", async () => {
    // Seed an Adzuna-discovered practice (unclassified) with a fresh staffing_spike.
    const practice = await upsertPractice(t.db, {
      name: "Rundberg Derm Associates",
      geoKey: "austin-tx",
    });
    await attachSignal(t.db, {
      practiceId: practice.id,
      kind: "staffing_spike",
      sourceUrl: "https://jobs.example/rundberg",
      detectedAt: NOW,
      expiresAt: computeExpiresAt("staffing_spike", NOW),
      signalSource: "adzuna",
    });

    await runDiscovery(baseDeps(t));

    const feed = await feedPractices(t.db, NOW);
    expect(feed).toHaveLength(1);
    // One practice, two DISTINCT signal kinds — the "discovery is enrichment for free" claim.
    expect(feed[0].signalCount).toBe(2);
    expect(feed[0].signals.map((s) => s.kind).sort()).toEqual(["phone_complaints", "staffing_spike"]);
    // The merge tightened the unclassified vertical so it stays feed-reachable (K7).
    expect(feed[0].vertical).toBe("dermatology");
  });

  it("skips a place with a fresh re-pull cache entry — no Details or LLM call (R7)", async () => {
    // Pre-seed ChIJlow as pulled just now: within the 90d window, so it is fresh.
    await upsertDiscoveryCandidate(t.db, {
      placeId: "ChIJlow",
      tenantId: TENANT.id,
      name: "Rundberg Dermatology",
      geoKey: "austin-tx",
      vertical: "dermatology",
      lastPulledAt: NOW,
      lastVerdict: "checked-no-signal",
      detectedAt: NOW,
    });

    const details = fakeDetailsFetcher({ responses: { ChIJlow: DETAILS_LOW_QUALIFIES } });
    const classify = FakeClassifyClient.byReview({ [REVIEW_PAIN]: QUALIFY });
    const summary = await runDiscovery(baseDeps(t, { detailsFetcher: details.fetch, classifyClient: classify }));

    expect(summary.cached).toBe(1);
    expect(details.calls).not.toContain("ChIJlow");
    expect(classify.calls).toHaveLength(0);
  });

  it("archives a high-rated place without a Details call (funnel, R2)", async () => {
    const details = fakeDetailsFetcher({ responses: { ChIJlow: DETAILS_LOW_QUALIFIES } });
    await runDiscovery(baseDeps(t, { detailsFetcher: details.fetch }));
    expect(details.calls).not.toContain("ChIJhigh");
    const [high] = await t.db
      .select()
      .from(discoveryCandidates)
      .where(eq(discoveryCandidates.placeId, "ChIJhigh"));
    expect(high.lastVerdict).toBe("not-targeted");
  });

  it("resurfaces a checked-no-signal place once its reviews qualify on a later run (R7)", async () => {
    // Run 1: the pain review does NOT qualify -> checked-no-signal, archived.
    const run1 = baseDeps(t, {
      classifyClient: FakeClassifyClient.byReview({}), // nothing qualifies
    });
    await runDiscovery(run1);
    expect((await feedPractices(t.db, NOW))).toHaveLength(0);

    // Run 2, AFTER the re-pull window (so the cache misses), now the review qualifies.
    const later = new Date("2026-10-20T00:00:00Z"); // > 90 days after NOW
    const run2 = baseDeps(t, {
      now: later,
      classifyClient: FakeClassifyClient.byReview({ [REVIEW_PAIN]: QUALIFY }),
    });
    const summary = await runDiscovery(run2);
    expect(summary.qualified).toBe(1);

    const feed = await feedPractices(t.db, later);
    expect(feed).toHaveLength(1);
    expect(feed[0].signals.map((s) => s.kind)).toEqual(["phone_complaints"]);
  });

  it("refreshes a re-qualified place's freshness so it never ages off the feed (recurring source)", async () => {
    // Run 1: qualifies at NOW -> phone_complaints signal expires NOW+90d.
    await runDiscovery(baseDeps(t));
    expect(await feedPractices(t.db, NOW)).toHaveLength(1);

    // 91 days on, the run-1 signal has expired -> the prospect is OFF the feed...
    const later = new Date(NOW.getTime() + 91 * 24 * 60 * 60 * 1000);
    expect(await feedPractices(t.db, later)).toHaveLength(0);

    // ...but a re-pull (cache has also expired) that STILL qualifies must REFRESH the
    // signal's freshness, putting the prospect back on the feed — not leave it frozen.
    const summary = await runDiscovery(baseDeps(t, { now: later }));
    expect(summary.qualified).toBe(1);
    const feed = await feedPractices(t.db, later);
    expect(feed).toHaveLength(1);
    expect(feed[0].signals.map((s) => s.kind)).toEqual(["phone_complaints"]);
  });

  it("stores NO review text anywhere after a full run (R5, Google ToS)", async () => {
    await runDiscovery(baseDeps(t));

    const evRows = await t.db.select().from(evidence);
    for (const ev of evRows) {
      expect(ev.snippet).toBeNull();
      expect(ev.sourceUrl).not.toContain("get through");
    }
    const sigRows = await t.db.select().from(signals);
    expect(sigRows.length).toBeGreaterThan(0);

    const discRows = await t.db.select().from(discoveryCandidates);
    const dumped = JSON.stringify(discRows);
    expect(dumped).not.toContain("get through");
    expect(dumped).not.toContain("on hold");
  });

  it("meters Text Search, Details, and each LLM call — all with practiceId null (R6)", async () => {
    const rec = recordingMeter();
    await runDiscovery(baseDeps(t, { meter: rec.meter }));

    const steps = rec.rows.map((r) => r.pipelineStep);
    expect(steps).toContain("discovery.search");
    expect(steps).toContain("discovery.details");
    expect(steps).toContain("discovery.classify");
    // Discovery runs before a practice exists, so every cost row is unattributed.
    for (const row of rec.rows) {
      expect(row.practiceId).toBeNull();
    }
    // 1 search + 1 details (only the low place) + 2 classify (its two reviews).
    expect(steps.filter((s) => s === "discovery.details")).toHaveLength(1);
    expect(steps.filter((s) => s === "discovery.classify")).toHaveLength(2);
  });

  it("isolates a Details fetch that throws — the run continues and marks it errored", async () => {
    const details = fakeDetailsFetcher({
      responses: { ChIJlow: DETAILS_LOW_QUALIFIES },
      throwFor: ["ChIJlow"],
    });
    const summary = await runDiscovery(baseDeps(t, { detailsFetcher: details.fetch }));

    expect(summary.errored).toBe(1);
    expect(summary.qualified).toBe(0);
    // The run did not throw — it returned a summary.
    expect(summary.ran).toBe(true);
    // The throwing Details call recorded NO cost row, so the call counter (printed
    // next to metered USD) must not count it; the search did succeed.
    expect(summary.calls.details).toBe(0);
    expect(summary.calls.search).toBe(1);
  });
});
