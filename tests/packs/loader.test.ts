import { describe, expect, it } from "vitest";
import { loadPack } from "@/src/packs/loader";
import type { PackInput } from "@/src/packs/schema";

/**
 * Loader validation tests (U7) — the heart of this unit. Covers every plan
 * scenario from the U7 spec: a valid pack loads; a pack missing any of the
 * five variables fails, naming the field; a proof point lacking a source URL
 * fails; the explicit `proof_pending` sentinel loads; and a silently blank/
 * empty proof (NOT the sentinel) fails.
 */

function validPack(): PackInput {
  return {
    vertical: "dermatology",
    painFit: {
      line: "Missed calls are lost new patients.",
      grounding: "Grounded in the dermatology vertical page.",
    },
    opener: {
      leadWith: "missed calls = lost new patients",
      vocabulary: ["missed calls", "new-patient capture"],
      tone: "commercially sharp",
      exampleOpener: "Most derm groups are losing the phone battle.",
    },
    proofPoint: {
      tag: "real",
      caseStudy: "Example Practice",
      metrics: ["2,000 calls/month"],
      sourceUrl: "https://example.com/case-study",
    },
    ehrSignals: [
      { name: "ModMed EMA", sourceUrl: "https://www.modmed.com/dermatology/" },
    ],
    roiBenchmark: {
      tag: "modeled",
      items: [
        { label: "No-show rate: 13.4%", sourceUrl: "https://example.com/study" },
      ],
    },
  };
}

describe("loadPack", () => {
  it("loads a valid pack with all five variables", () => {
    const result = loadPack(validPack());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.pack.vertical).toBe("dermatology");
      expect(result.pack.proofPoint.tag).toBe("real");
    }
  });

  it.each([
    "painFit",
    "opener",
    "proofPoint",
    "ehrSignals",
    "roiBenchmark",
  ] as const)("fails when %s is missing, naming the field", (field) => {
    const pack = validPack();
    delete (pack as Record<string, unknown>)[field];
    const result = loadPack(pack);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain(field);
    }
  });

  it("fails when the vertical field is missing", () => {
    const pack = validPack();
    delete (pack as Record<string, unknown>).vertical;
    const result = loadPack(pack);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("vertical");
  });

  it("fails when a real proof point lacks a source URL", () => {
    const pack = validPack();
    pack.proofPoint = {
      tag: "real",
      caseStudy: "Example Practice",
      metrics: ["2,000 calls/month"],
    } as PackInput["proofPoint"];
    const result = loadPack(pack);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("sourceUrl");
  });

  it("fails when a real proof point's source URL is malformed", () => {
    const pack = validPack();
    pack.proofPoint = {
      tag: "real",
      caseStudy: "Example Practice",
      metrics: ["2,000 calls/month"],
      sourceUrl: "not-a-url",
    };
    const result = loadPack(pack);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("sourceUrl");
  });

  it("loads and validates the explicit proof_pending sentinel", () => {
    const pack = validPack();
    pack.proofPoint = { tag: "proof_pending" };
    const result = loadPack(pack);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.pack.proofPoint).toEqual({ tag: "proof_pending" });
  });

  it("fails a silently blank proof point (empty string) — NOT the sentinel", () => {
    const pack = validPack();
    (pack as Record<string, unknown>).proofPoint = "";
    const result = loadPack(pack);
    expect(result.ok).toBe(false);
  });

  it("fails a silently blank proof point (null) — NOT the sentinel", () => {
    const pack = validPack();
    (pack as Record<string, unknown>).proofPoint = null;
    const result = loadPack(pack);
    expect(result.ok).toBe(false);
  });

  it("fails a proof point with an unrecognized tag (not real, not proof_pending)", () => {
    const pack = validPack();
    (pack as Record<string, unknown>).proofPoint = { tag: "fabricated" };
    const result = loadPack(pack);
    expect(result.ok).toBe(false);
  });

  it("fails when an EHR signal's source URL is malformed", () => {
    const pack = validPack();
    pack.ehrSignals = [{ name: "ModMed EMA", sourceUrl: "not-a-url" }];
    const result = loadPack(pack);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("ehrSignals");
  });

  it("allows an EHR signal with no source URL (ideally has one, not required)", () => {
    const pack = validPack();
    pack.ehrSignals = [{ name: "ModMed EMA" }];
    const result = loadPack(pack);
    expect(result.ok).toBe(true);
  });

  it("fails when a roiBenchmark item lacks a source URL", () => {
    const pack = validPack();
    pack.roiBenchmark = {
      tag: "modeled",
      items: [{ label: "No-show rate: 13.4%" } as never],
    };
    const result = loadPack(pack);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("roiBenchmark");
  });

  it("rejects a non-object input entirely", () => {
    expect(loadPack(null).ok).toBe(false);
    expect(loadPack(undefined).ok).toBe(false);
    expect(loadPack("not a pack").ok).toBe(false);
  });
});
