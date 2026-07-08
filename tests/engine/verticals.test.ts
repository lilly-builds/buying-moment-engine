import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../setup";
import { upsertPractice, upsertSignal } from "@/db/ingest";
import { feedPractices } from "@/db/queries";
import { evidence } from "@/db/schema";
import {
  classifyVertical,
  isFeedEligible,
  normalizeText,
  verticalsForEhr,
} from "@/src/engine/verticals";

const DETECTED = new Date("2026-07-01T00:00:00Z");

describe("vertical classification from specialty keywords (R6)", () => {
  it.each([
    ["Sunshine Dermatology Associates", "dermatology"],
    ["Coastal Skin Cancer & Mohs Center", "dermatology"],
    ["Riverbend OB-GYN", "womens_health"],
    ["Willow Obstetrics and Gynecology", "womens_health"],
    ["Harbor Vision Eye Care", "ophthalmology"],
    ["Cascade Retina Institute", "ophthalmology"],
    ["Metro Ortho Group — Orthopedics", "orthopedics"],
    ["Summit Sports Medicine & Joint Replacement", "orthopedics"],
  ])("classifies %s as %s", (text, expected) => {
    const result = classifyVertical({ text });
    expect(result.vertical).toBe(expected);
    expect(result.reason).toBe("specialty_keywords");
  });

  it("SCENARIO 6: an unclassifiable specialty is tagged `unclassified`", () => {
    const result = classifyVertical({ text: "Lakeside Family Practice" });
    expect(result.vertical).toBe("unclassified");
    expect(result.reason).toBe("no_signal");
    expect(isFeedEligible(result.vertical)).toBe(false);
  });

  it("a genuinely multi-specialty name is unclassified, never misfiled", () => {
    const result = classifyVertical({
      text: "Peninsula Dermatology and Orthopedics",
    });
    expect(result.vertical).toBe("unclassified");
    expect(result.reason).toBe("ambiguous_specialty");
  });
});

describe("EHR-as-signal, drawn from the authored packs", () => {
  it("uses a single-vertical EHR when the specialty text says nothing", () => {
    const result = classifyVertical({
      text: "Metro Health Partners",
      ehr: "Phoenix Ortho",
    });
    expect(result.vertical).toBe("orthopedics");
    expect(result.reason).toBe("ehr_signal");
  });

  it("digiChart resolves womens_health", () => {
    expect(verticalsForEhr("digiChart")).toEqual(["womens_health"]);
  });

  it("ModMed is AMBIGUOUS — three packs list it, so it classifies nothing", () => {
    expect(verticalsForEhr("ModMed").length).toBeGreaterThan(1);
    const result = classifyVertical({ text: "Valley Health", ehr: "ModMed" });
    expect(result.vertical).toBe("unclassified");
    expect(result.reason).toBe("ambiguous_ehr");
  });

  it("Nextech is AMBIGUOUS across derm / ophtha / ortho", () => {
    expect(verticalsForEhr("Nextech").sort()).toEqual([
      "dermatology",
      "ophthalmology",
      "orthopedics",
    ]);
  });

  it("specialty keywords beat the EHR when both are present", () => {
    const result = classifyVertical({
      text: "Sunshine Dermatology",
      ehr: "Phoenix Ortho",
    });
    expect(result.vertical).toBe("dermatology");
    expect(result.reason).toBe("specialty_keywords");
  });

  it("a single-vertical EHR breaks a two-specialty tie, but only among candidates", () => {
    const broken = classifyVertical({
      text: "Peninsula Dermatology and Orthopedics",
      ehr: "Phoenix Ortho",
    });
    expect(broken.vertical).toBe("orthopedics");
    expect(broken.reason).toBe("ehr_signal");

    // digiChart is not one of the two candidates -> the EHR must not overrule.
    const unbroken = classifyVertical({
      text: "Peninsula Dermatology and Orthopedics",
      ehr: "digiChart",
    });
    expect(unbroken.vertical).toBe("unclassified");
  });

  it("an unknown EHR contributes nothing", () => {
    expect(verticalsForEhr("Epic")).toEqual([]);
    expect(verticalsForEhr("")).toEqual([]);
  });

  it("normalizeText lowercases and strips punctuation", () => {
    expect(normalizeText("ModMed EMA (Dermatology)")).toBe(
      "modmed ema dermatology",
    );
  });
});

describe("SCENARIO 6 (DB half): unclassified is excluded from the feed", () => {
  let t: TestDb;
  beforeEach(async () => {
    t = await createTestDb();
  });
  afterEach(async () => {
    await t.close();
  });

  it("a signal-bearing unclassified practice never reaches the feed", async () => {
    const classified = await upsertPractice(t.db, {
      name: "Sunshine Dermatology",
      geoKey: "miami-fl",
      vertical: "dermatology",
    });
    const unclassified = await upsertPractice(t.db, {
      name: "Lakeside Family Practice",
      geoKey: "miami-fl",
      vertical: "unclassified",
    });

    for (const [practiceId, url] of [
      [classified.id, "https://a.example.com"],
      [unclassified.id, "https://b.example.com"],
      // Give the unclassified practice MORE signals: it would otherwise outrank
      // the classified one, so this proves exclusion rather than lucky ordering.
      [unclassified.id, "https://c.example.com"],
    ] as const) {
      const [ev] = await t.db
        .insert(evidence)
        .values({ sourceUrl: url, detectedAt: DETECTED })
        .returning({ id: evidence.id });
      await upsertSignal(t.db, {
        practiceId,
        kind: url.includes("c.") ? "growth_events" : "staffing_spike",
        evidenceId: ev.id,
        detectedAt: DETECTED,
      });
    }

    const feed = await feedPractices(t.db);
    expect(feed.map((r) => r.id)).toEqual([classified.id]);
    expect(feed.map((r) => r.name)).not.toContain("Lakeside Family Practice");
  });
});
