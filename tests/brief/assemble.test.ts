import { describe, expect, it } from "vitest";
import { assembleFactual, signalFingerprint } from "@/src/brief/assemble";
import { freshSignals, groundingParts, type BriefInput, type FactRow, type SignalRow } from "@/src/brief/inputs";
import { buildGroundingCorpus } from "@/src/brief/lint";
import { getPack } from "@/src/packs";
import { ZERO_SIGNAL_HEADLINE } from "@/src/brief/schema";

/**
 * Stage 1 is pure: (rows, pack, now) in, factual tier out. No database, no clock, no model.
 * These tests are the reason that purity is worth having.
 */

const DETECTED = new Date("2026-07-01T00:00:00Z");
const NOW = new Date("2026-07-06T00:00:00Z");

function fact(field: string, value: string, snippet: string | null = "the page says so"): FactRow {
  return {
    field,
    value,
    provider: "claude_research",
    evidence: {
      id: `ev-${field}`,
      sourceUrl: `https://practice.example/${field}`,
      snippet,
      detectedAt: DETECTED,
      confidence: 0.9,
    },
  };
}

function signal(kind: SignalRow["kind"], expiresAt: Date | null): SignalRow {
  return {
    kind,
    signalSource: "adzuna",
    detectedAt: DETECTED,
    expiresAt,
    confidence: 0.9,
    evidence: {
      id: `ev-${kind}`,
      sourceUrl: `https://source.example/${kind}`,
      snippet: "hiring a patient coordinator",
      detectedAt: DETECTED,
      confidence: 0.9,
    },
  };
}

function input(overrides: Partial<BriefInput> = {}): BriefInput {
  return {
    practice: {
      id: "p1",
      name: "Metro Derm",
      city: "Omaha",
      state: "NE",
      vertical: "dermatology",
    },
    facts: [fact("specialty", "Dermatology"), fact("yearFounded", "2004")],
    signals: [signal("staffing_spike", new Date("2026-07-31T00:00:00Z"))],
    contact: null,
    pack: getPack("dermatology"),
    ...overrides,
  };
}

describe("assembleFactual", () => {
  it("builds every profile claim with its evidence id, source URL and quote", () => {
    const { factual } = assembleFactual(input(), NOW);
    expect(factual.profile).toEqual([
      expect.objectContaining({ label: "Specialty", value: "Dermatology", evidenceId: "ev-specialty" }),
      expect.objectContaining({ label: "Founded", value: "2004", evidenceId: "ev-yearFounded" }),
    ]);
    expect(factual.profile[0].href).toContain(":~:text=");
  });

  it("falls back to the bare page URL when a fact has no snippet to point at", () => {
    const { factual } = assembleFactual(
      input({ facts: [fact("specialty", "Dermatology", null)] }),
      NOW,
    );
    expect(factual.profile[0].quote).toBeNull();
    expect(factual.profile[0].href).toBe("https://practice.example/specialty");
  });

  it("omits a profile row the evidence never supplied, rather than emitting a blank", () => {
    const { factual } = assembleFactual(input({ facts: [fact("specialty", "Dermatology")] }), NOW);
    expect(factual.profile.map((c) => c.label)).toEqual(["Specialty"]);
  });

  it("orders indexed tooling numerically, not lexicographically", () => {
    // `incumbent_tooling_10` sorts before `_2` as a string. The card's row order must not
    // flip the moment a practice has ten of anything.
    const facts = [
      fact("incumbent_tooling_10", "Tenth"),
      fact("incumbent_tooling_2", "Second"),
      fact("incumbent_tooling_1", "First"),
    ];
    const { factual } = assembleFactual(input({ facts }), NOW);
    expect(factual.incumbentTooling.map((c) => c.value)).toEqual(["First", "Second", "Tenth"]);
  });

  it("puts the EHR ahead of other incumbent tooling", () => {
    const facts = [fact("incumbent_tooling_1", "Podium reviews"), fact("ehr", "ModMed EMA")];
    const { factual } = assembleFactual(input({ facts }), NOW);
    expect(factual.incumbentTooling.map((c) => c.label)).toEqual(["EHR", "Incumbent tooling"]);
  });

  // ─── scenario 5: swapping the pack changes the pitch, never the card ───────────────────
  it("swapping the vertical pack changes the pain line and proof point, not the structure", () => {
    const derm = assembleFactual(input(), NOW).factual;
    const ortho = assembleFactual(
      input({
        practice: { ...input().practice, vertical: "orthopedics" },
        pack: getPack("orthopedics"),
      }),
      NOW,
    ).factual;

    expect(ortho.painFit).not.toBe(derm.painFit);
    expect(ortho.roiRange.items).not.toEqual(derm.roiRange.items);
    if (derm.proofPoint.tag === "real" && ortho.proofPoint.tag === "real") {
      expect(ortho.proofPoint.caseStudy).not.toBe(derm.proofPoint.caseStudy);
    }

    // One engine, four pitches: identical shape, identical field set, identical claim keys.
    expect(Object.keys(ortho).sort()).toEqual(Object.keys(derm).sort());
    expect(ortho.profile.map((c) => c.label)).toEqual(derm.profile.map((c) => c.label));
    expect(ortho.roiRange.tag).toBe("modeled");
  });

  it("keeps the pack's proof point and ROI links bare — a fragment from a summary never matches", () => {
    const { factual } = assembleFactual(input(), NOW);
    if (factual.proofPoint.tag !== "real") throw new Error("derm pack should carry a real proof");
    expect(factual.proofPoint.href).toBe(factual.proofPoint.sourceUrl);
    expect(factual.proofPoint.href).not.toContain(":~:");
    for (const item of factual.roiRange.items) expect(item.href).toBe(item.sourceUrl);
  });

  // ─── freshness drives which signals exist at all ───────────────────────────────────────
  it("ignores a signal that has aged out of its window", () => {
    const stale = signal("staffing_spike", new Date("2026-07-02T00:00:00Z"));
    const { factual, signals } = assembleFactual(input({ signals: [stale] }), NOW);
    expect(signals).toEqual([]);
    expect(factual.zeroSignal).toBe(true);
    expect(factual.headline).toBe(ZERO_SIGNAL_HEADLINE);
    expect(factual.signalFingerprint).toEqual([]);
  });

  it("treats a signal with no expiry as fresh, never silently dropping it", () => {
    const { signals } = assembleFactual(input({ signals: [signal("growth_events", null)] }), NOW);
    expect(signals).toHaveLength(1);
  });

  it("leaves the headline to the model when a moment has fired", () => {
    const { factual } = assembleFactual(input(), NOW);
    expect(factual.zeroSignal).toBe(false);
    expect(factual.headline).toBeNull();
  });

  // ─── the contact card ─────────────────────────────────────────────────────────────────
  it("derives the best channel from what we actually hold, and calls it ours", () => {
    const withEmail = assembleFactual(
      input({
        contact: {
          name: "Jo Ito",
          role: "Practice Manager",
          email: "jo@x.example",
          emailProvider: "pdl",
          linkedinUrl: null,
          bestChannel: null,
          sourceUrl: "https://practice.example/team",
        },
      }),
      NOW,
    ).factual;
    expect(withEmail.contact).toMatchObject({ variant: "named", bestChannel: "email" });

    const roleOnly = assembleFactual(
      input({
        contact: {
          name: null,
          role: "Practice Manager",
          email: null,
          emailProvider: null,
          linkedinUrl: null,
          bestChannel: null,
          sourceUrl: null,
        },
      }),
      NOW,
    ).factual;
    expect(roleOnly.contact).toMatchObject({ variant: "role_only", bestChannel: "phone", sourceHref: null });
  });

  it("uses the contact's real LinkedIn profile when we hold one", () => {
    const { factual } = assembleFactual(
      input({
        contact: {
          name: "Jo Ito",
          role: "Practice Manager",
          email: null,
          emailProvider: null,
          linkedinUrl: "https://www.linkedin.com/in/joito",
          bestChannel: null,
          sourceUrl: null,
        },
      }),
      NOW,
    );
    expect(factual.contact!.linkedinHref).toBe("https://www.linkedin.com/in/joito");
    expect(factual.contact!.bestChannel).toBe("linkedin");
  });
});

describe("groundingParts (P2-5, P1-3)", () => {
  function withSnippet(row: SignalRow, snippet: string): SignalRow {
    return { ...row, evidence: { ...row.evidence, snippet } };
  }

  it("grounds a FRESH signal's number, never an expired one's", () => {
    const fresh = withSnippet(signal("staffing_spike", new Date("2026-07-31T00:00:00Z")), "Hiring 3 front-desk staff.");
    const expired = withSnippet(signal("growth_events", new Date("2026-07-02T00:00:00Z")), "Now serving 888 patients.");
    const briefInput = input({ signals: [fresh, expired] });

    // The caller passes the FRESH set, exactly as `attemptVoice` does. The expired signal was
    // never shown to the model, so its 888 must not ground prose (P2-5).
    const corpus = buildGroundingCorpus(groundingParts(briefInput, freshSignals(briefInput.signals, NOW)));
    expect(corpus.evidence.has("3")).toBe(true);
    expect(corpus.evidence.has("888")).toBe(false);
  });

  it("keeps the pack's proof figures in the pack set, out of the evidence set (P1-3)", () => {
    const briefInput = input();
    const corpus = buildGroundingCorpus(groundingParts(briefInput, freshSignals(briefInput.signals, NOW)));
    // Texas Dermatology's 2,000 calls / 250 new patients are the pack's proof — never this
    // practice's numbers, so evidence must not hold them and pack must.
    expect(corpus.evidence.has("2000")).toBe(false);
    expect(corpus.pack.has("2000")).toBe(true);
    expect(corpus.pack.has("250")).toBe(true);
  });

  it("drops the website fact's URL value but keeps its snippet (P2-5)", () => {
    const website = fact("website", "https://clinic-2020.example", "Visit our Omaha office.");
    const briefInput = input({ facts: [fact("specialty", "Dermatology"), website] });
    const corpus = buildGroundingCorpus(groundingParts(briefInput, freshSignals(briefInput.signals, NOW)));
    // 2020 lives only in the URL — an address, not a measurement — so it must not ground a stat.
    expect(corpus.evidence.has("2020")).toBe(false);
  });
});

describe("signalFingerprint", () => {
  it("is order-independent, so a row-order change is not a signal change", () => {
    const a = signal("staffing_spike", null);
    const b = signal("phone_complaints", null);
    expect(signalFingerprint([a, b])).toEqual(signalFingerprint([b, a]));
  });

  it("changes when a signal is added", () => {
    const a = signal("staffing_spike", null);
    const b = signal("phone_complaints", null);
    expect(signalFingerprint([a])).not.toEqual(signalFingerprint([a, b]));
  });
});
