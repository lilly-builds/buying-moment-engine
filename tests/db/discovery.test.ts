import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../setup";
import {
  isPlaceFresh,
  upsertDiscoveryCandidate,
  type DiscoveryCandidateRow,
} from "@/db/discovery";
import { discoveryCandidates } from "@/db/schema";

const NOW = new Date("2026-07-09T00:00:00Z");

function baseRow(overrides: Partial<DiscoveryCandidateRow> = {}): DiscoveryCandidateRow {
  return {
    placeId: "ChIJrundberg_derm",
    tenantId: "eliseai",
    name: "Rundberg Dermatology",
    geoKey: "austin-tx",
    vertical: "dermatology",
    rating: 2.8,
    reviewCount: 176,
    lastPulledAt: NOW,
    lastVerdict: "checked-no-signal",
    detectedAt: NOW,
    ...overrides,
  };
}

describe("upsertDiscoveryCandidate", () => {
  let t: TestDb;
  beforeEach(async () => {
    t = await createTestDb();
  });
  afterEach(async () => {
    await t.close();
  });

  it("insert then re-upsert the same place_id is ONE row with refreshed fields (no duplicate)", async () => {
    await upsertDiscoveryCandidate(t.db, baseRow({ lastVerdict: "checked-no-signal" }));

    const later = new Date("2026-07-20T00:00:00Z");
    const saved = await upsertDiscoveryCandidate(
      t.db,
      baseRow({ lastVerdict: "qualified", lastPulledAt: later, qualifiedKind: "phone_complaints" }),
    );

    const all = await t.db.select().from(discoveryCandidates);
    expect(all).toHaveLength(1);
    expect(saved.lastVerdict).toBe("qualified");
    expect(saved.qualifiedKind).toBe("phone_complaints");
    expect(saved.lastPulledAt?.toISOString()).toBe(later.toISOString());
    // First-seen provenance is preserved across the update.
    expect(saved.detectedAt.toISOString()).toBe(NOW.toISOString());
  });

  it("preserves the row across a checked-no-signal -> qualified resurface (R7)", async () => {
    await upsertDiscoveryCandidate(t.db, baseRow({ lastVerdict: "checked-no-signal", qualifiedKind: null }));
    await upsertDiscoveryCandidate(t.db, baseRow({ lastVerdict: "qualified", qualifiedKind: "phone_complaints" }));

    const [row] = await t.db.select().from(discoveryCandidates);
    expect(row.lastVerdict).toBe("qualified");
    expect(row.qualifiedKind).toBe("phone_complaints");
  });

  it("stores rating as numeric and never holds review text (R5) — asserts the row shape", async () => {
    const saved = await upsertDiscoveryCandidate(t.db, baseRow());
    // Every persisted column is place_id, a public listing fact, or our own verdict —
    // there is no column that could carry a review's words.
    expect(Object.keys(saved).sort()).toEqual(
      [
        "createdAt",
        "detectedAt",
        "geoKey",
        "lastPulledAt",
        "lastVerdict",
        "name",
        "placeId",
        "qualifiedKind",
        "rating",
        "reviewCount",
        "tenantId",
        "updatedAt",
        "vertical",
      ].sort(),
    );
    expect(Number(saved.rating)).toBeCloseTo(2.8, 5);
    expect(saved.reviewCount).toBe(176);
  });

  it("accepts an unrated funnel-dropped place with null rating + null last_pulled_at", async () => {
    const saved = await upsertDiscoveryCandidate(
      t.db,
      baseRow({
        placeId: "ChIJhigh",
        rating: null,
        lastPulledAt: null,
        lastVerdict: "not-targeted",
        vertical: null,
      }),
    );
    expect(saved.rating).toBeNull();
    expect(saved.lastPulledAt).toBeNull();
    expect(saved.lastVerdict).toBe("not-targeted");
  });
});

describe("isPlaceFresh — the re-pull cache gate", () => {
  let t: TestDb;
  beforeEach(async () => {
    t = await createTestDb();
  });
  afterEach(async () => {
    await t.close();
  });

  it("is FALSE for a place that does not exist (never enumerated)", async () => {
    expect(await isPlaceFresh(t.db, "ChIJmissing", NOW, 30)).toBe(false);
  });

  it("is FALSE for a place that exists but was never pulled (last_pulled_at IS NULL)", async () => {
    await upsertDiscoveryCandidate(
      t.db,
      baseRow({ placeId: "ChIJarchived", lastPulledAt: null, lastVerdict: "not-targeted" }),
    );
    expect(await isPlaceFresh(t.db, "ChIJarchived", NOW, 30)).toBe(false);
  });

  it("is TRUE when last_pulled_at is within the window, FALSE once it ages out", async () => {
    const pulledAt = new Date("2026-07-01T00:00:00Z");
    await upsertDiscoveryCandidate(t.db, baseRow({ lastPulledAt: pulledAt }));

    // 8 days later, 30-day window -> still fresh.
    expect(await isPlaceFresh(t.db, baseRow().placeId, new Date("2026-07-09T00:00:00Z"), 30)).toBe(true);
    // 40 days later, 30-day window -> stale, pull again.
    expect(await isPlaceFresh(t.db, baseRow().placeId, new Date("2026-08-10T00:00:00Z"), 30)).toBe(false);
  });
});
