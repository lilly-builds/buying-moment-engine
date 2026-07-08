import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { count, eq } from "drizzle-orm";
import { createTestDb, type TestDb } from "../setup";
import { evidence, practices, signals } from "@/db/schema";
import {
  attachSignal,
  canonicalizeName,
  firedSignalCount,
  isSameEntity,
  nameSimilarity,
  resolvePractice,
  tagVertical,
} from "@/src/engine/resolver";

const DETECTED = new Date("2026-07-01T00:00:00Z");

describe("name canonicalization + similarity (pure, no DB)", () => {
  it("drops legal suffixes and filler, expands abbreviations", () => {
    expect(canonicalizeName("Sunshine Dermatology Assoc., P.A.")).toEqual([
      "sunshine",
      "dermatology",
      "associates",
    ]);
    expect(canonicalizeName("The Metro Ortho Group, LLC")).toEqual([
      "metro",
      "orthopedics",
      "group",
    ]);
  });

  it("scores different spellings of the same practice above threshold", () => {
    expect(
      nameSimilarity(
        "Sunshine Dermatology Associates",
        "Sunshine Derm Assoc., P.A.",
      ),
    ).toBe(1);
    expect(
      nameSimilarity("Metro Ortho Group", "Metro Orthopaedic Group LLC"),
    ).toBe(1);
  });

  it("keeps genuinely different practices apart", () => {
    expect(
      nameSimilarity("Sunshine Dermatology", "Sunrise Dermatology"),
    ).toBeLessThan(0.6);
    expect(nameSimilarity("Harbor Vision", "Cascade Retina")).toBe(0);
  });

  it("geo is a HARD gate — same name, different metro, different business", () => {
    expect(
      isSameEntity(
        { name: "Summit Orthopedics", geoKey: "denver-co" },
        { name: "Summit Orthopedics", geoKey: "seattle-wa" },
      ),
    ).toBe(false);
    expect(
      isSameEntity(
        { name: "Summit Orthopedics", geoKey: "denver-co" },
        { name: "Summit Orthopaedics, P.C.", geoKey: "denver-co" },
      ),
    ).toBe(true);
  });

  it("an all-noise name never matches anything", () => {
    expect(nameSimilarity("The LLC", "Inc Co")).toBe(0);
  });
});

describe("practice resolution + derived signal count", () => {
  let t: TestDb;
  beforeEach(async () => {
    t = await createTestDb();
  });
  afterEach(async () => {
    await t.close();
  });

  it("SCENARIO 1: two spellings merge into ONE practice with TWO signals", async () => {
    const first = await resolvePractice(t.db, {
      name: "Sunshine Dermatology Associates",
      geoKey: "miami-fl",
      city: "Miami",
      state: "FL",
    });
    expect(first.merged).toBe(false);

    const second = await resolvePractice(t.db, {
      name: "Sunshine Derm Assoc., P.A.",
      geoKey: "miami-fl",
    });
    expect(second.merged).toBe(true);
    expect(second.practiceId).toBe(first.practiceId);
    expect(second.matchedName).toBe("Sunshine Dermatology Associates");

    await attachSignal(t.db, {
      practiceId: first.practiceId,
      kind: "staffing_spike",
      sourceUrl: "https://jobs.example.com/front-desk",
      snippet: "Hiring two patient coordinators",
      confidence: 0.8,
      detectedAt: DETECTED,
    });
    await attachSignal(t.db, {
      practiceId: second.practiceId,
      kind: "phone_complaints",
      sourceUrl: "https://reviews.example.com/sunshine",
      snippet: "Could never get through on the phone",
      confidence: 0.7,
      detectedAt: DETECTED,
    });

    const rows = await t.db.select().from(practices);
    expect(rows).toHaveLength(1);
    expect(await firedSignalCount(t.db, first.practiceId)).toBe(2);
  });

  it("does NOT merge a similarly-named practice in another geo", async () => {
    const denver = await resolvePractice(t.db, {
      name: "Summit Orthopedics",
      geoKey: "denver-co",
    });
    const seattle = await resolvePractice(t.db, {
      name: "Summit Orthopaedics, P.C.",
      geoKey: "seattle-wa",
    });
    expect(seattle.merged).toBe(false);
    expect(seattle.practiceId).not.toBe(denver.practiceId);
    expect(await t.db.select().from(practices)).toHaveLength(2);
  });

  it("SCENARIO 7: signal count equals DISTINCT FIRED KINDS, not evidence rows", async () => {
    const { practiceId } = await resolvePractice(t.db, {
      name: "Metro Ortho Group",
      geoKey: "denver-co",
    });

    // Three job posts = three evidence rows = ONE staffing-spike signal kind.
    for (const url of [
      "https://jobs.example.com/1",
      "https://jobs.example.com/2",
      "https://jobs.example.com/3",
    ]) {
      await attachSignal(t.db, {
        practiceId,
        kind: "staffing_spike",
        sourceUrl: url,
        detectedAt: DETECTED,
      });
    }
    expect(await firedSignalCount(t.db, practiceId)).toBe(1);

    await attachSignal(t.db, {
      practiceId,
      kind: "growth_events",
      sourceUrl: "https://news.example.com/pe-deal",
      detectedAt: DETECTED,
    });
    expect(await firedSignalCount(t.db, practiceId)).toBe(2);
  });

  it("EDGE CASE: a practice with zero signals counts 0, never null", async () => {
    const { practiceId } = await resolvePractice(t.db, {
      name: "Quiet Dermatology",
      geoKey: "boise-id",
    });
    expect(await firedSignalCount(t.db, practiceId)).toBe(0);
  });

  it("re-attaching identical evidence is idempotent — no duplicate evidence or signal rows", async () => {
    const { practiceId } = await resolvePractice(t.db, {
      name: "Harbor Vision Eye Care",
      geoKey: "portland-or",
    });
    const attach = () =>
      attachSignal(t.db, {
        practiceId,
        kind: "phone_complaints" as const,
        sourceUrl: "https://reviews.example.com/harbor",
        detectedAt: DETECTED,
      });

    const first = await attach();
    const second = await attach(); // the re-attach — this is the whole point

    expect(first.id).toBeTruthy();
    // Same signal row returned, not a second one.
    expect(second.id).toBe(first.id);

    // Count the ROWS, not the derived signal count. `firedSignalCount` counts
    // DISTINCT kinds, so it reads 1 even when the tables have silently doubled —
    // which is exactly how the original version of this test hid the bug.
    const [{ n: evidenceRows }] = await t.db
      .select({ n: count() })
      .from(evidence)
      .innerJoin(signals, eq(signals.evidenceId, evidence.id))
      .where(eq(signals.practiceId, practiceId));
    const [{ n: signalRows }] = await t.db
      .select({ n: count() })
      .from(signals)
      .where(eq(signals.practiceId, practiceId));

    expect(evidenceRows).toBe(1);
    expect(signalRows).toBe(1);
    expect(await firedSignalCount(t.db, practiceId)).toBe(1);
  });

  it("a DIFFERENT source URL for the same kind attaches as new evidence", async () => {
    // Guard the other direction: dedupe must key on the citation, not collapse
    // two genuinely distinct sources into one. Two reviews on different pages are
    // two pieces of evidence for one fired signal kind.
    const { practiceId } = await resolvePractice(t.db, {
      name: "Cascade Vision Partners",
      geoKey: "portland-or",
    });
    for (const url of ["https://a.example.com/r1", "https://b.example.com/r2"]) {
      await attachSignal(t.db, {
        practiceId,
        kind: "phone_complaints",
        sourceUrl: url,
        detectedAt: DETECTED,
      });
    }
    const [{ n: signalRows }] = await t.db
      .select({ n: count() })
      .from(signals)
      .where(eq(signals.practiceId, practiceId));
    expect(signalRows).toBe(2);
    // ...but still ONE fired signal kind (D8/R1).
    expect(await firedSignalCount(t.db, practiceId)).toBe(1);
  });

  it("tagVertical only ever tightens `unclassified` -> a real vertical", async () => {
    const { practiceId } = await resolvePractice(t.db, {
      name: "Sunshine Dermatology",
      geoKey: "miami-fl",
    });
    await tagVertical(t.db, practiceId, "dermatology");
    await tagVertical(t.db, practiceId, "orthopedics"); // must be a no-op

    const [row] = await t.db.select().from(practices);
    expect(row.vertical).toBe("dermatology");
  });
});
