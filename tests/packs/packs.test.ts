import { describe, expect, it } from "vitest";
import { dermatologyPack } from "@/src/packs/dermatology";
import { getAllPacks, getPack, PACK_VERTICALS } from "@/src/packs/index";
import { loadPack } from "@/src/packs/loader";
import { ophthalmologyPack } from "@/src/packs/ophthalmology";
import { orthopedicsPack } from "@/src/packs/orthopedics";
import { womensHealthPack } from "@/src/packs/womens-health";

/**
 * The four authored packs (U13) — every proof point + benchmark URL is
 * transcribed verbatim from `wave1-research/vertical-packs.md` (see
 * docs/pack-sources.md for the fetch/verify ledger). This test proves all
 * four load and validate 4/4, and pins down which proof-point tag each
 * vertical ships — three `real` case studies, one explicit `proof_pending`.
 */

const LIVE_LOOKING_URL = /^https:\/\/[^\s]+\.[a-z]{2,}(\/[^\s]*)?$/i;

describe("all four authored packs load and validate", () => {
  it.each([
    ["dermatology", dermatologyPack],
    ["womens_health", womensHealthPack],
    ["ophthalmology", ophthalmologyPack],
    ["orthopedics", orthopedicsPack],
  ] as const)("%s pack passes loadPack validation", (vertical, raw) => {
    const result = loadPack(raw);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.pack.vertical).toBe(vertical);
  });

  it("getAllPacks() loads and validates 4/4 by vertical", () => {
    const all = getAllPacks();
    expect(Object.keys(all).sort()).toEqual([...PACK_VERTICALS].sort());
    for (const vertical of PACK_VERTICALS) {
      expect(all[vertical].vertical).toBe(vertical);
    }
  });

  it("getPack() loads a single vertical by name", () => {
    expect(getPack("dermatology").vertical).toBe("dermatology");
  });
});

describe("proof-point states — transcribed, not invented", () => {
  it("dermatology proof point is real: Texas Dermatology", () => {
    const pack = getPack("dermatology");
    expect(pack.proofPoint.tag).toBe("real");
    if (pack.proofPoint.tag === "real") {
      expect(pack.proofPoint.caseStudy).toBe("Texas Dermatology");
      expect(pack.proofPoint.sourceUrl).toMatch(LIVE_LOOKING_URL);
    }
  });

  it("women's health proof point is real: Women's Health Connecticut", () => {
    const pack = getPack("womens_health");
    expect(pack.proofPoint.tag).toBe("real");
    if (pack.proofPoint.tag === "real") {
      expect(pack.proofPoint.caseStudy).toBe("Women's Health Connecticut");
      expect(pack.proofPoint.sourceUrl).toMatch(LIVE_LOOKING_URL);
    }
  });

  it("ophthalmology proof point is real: Grin Eye Care", () => {
    const pack = getPack("ophthalmology");
    expect(pack.proofPoint.tag).toBe("real");
    if (pack.proofPoint.tag === "real") {
      expect(pack.proofPoint.caseStudy).toContain("Grin Eye Care");
      expect(pack.proofPoint.sourceUrl).toMatch(LIVE_LOOKING_URL);
    }
  });

  it("orthopedics proof point is the explicit proof_pending sentinel — no fabricated metric", () => {
    const pack = getPack("orthopedics");
    expect(pack.proofPoint).toEqual({ tag: "proof_pending" });
  });
});

describe("every pack carries the five variables and citations (R5/R6)", () => {
  it.each(PACK_VERTICALS)("%s has all five variables + cited claims", (vertical) => {
    const pack = getPack(vertical);
    expect(pack.painFit.line.length).toBeGreaterThan(0);
    expect(pack.opener.vocabulary.length).toBeGreaterThan(0);
    expect(["real", "proof_pending"]).toContain(pack.proofPoint.tag);
    expect(pack.ehrSignals.length).toBeGreaterThan(0);
    expect(pack.roiBenchmark.tag).toBe("modeled");
    expect(pack.roiBenchmark.items.length).toBeGreaterThan(0);
    for (const item of pack.roiBenchmark.items) {
      expect(item.sourceUrl).toMatch(LIVE_LOOKING_URL);
    }
  });
});
