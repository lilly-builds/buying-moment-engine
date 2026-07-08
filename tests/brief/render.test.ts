import { describe, expect, it } from "vitest";
import { assembleFactual } from "@/src/brief/assemble";
import type { BriefInput, SignalRow } from "@/src/brief/inputs";
import { freshnessTier, isBriefStale, liveSignalView, nextExpiryAt, renderBrief } from "@/src/brief/render";
import { getPack } from "@/src/packs";
import type { VoiceBrief } from "@/src/brief/schema";

/**
 * The KTD, as tests: **a stored brief can never claim a buying moment that has expired.**
 *
 * The signal count, the fired-signal list and the freshness badge are computed here from
 * the `signals` table, every render. Nothing time-sensitive is read out of stored JSON, and
 * `isBriefStale` is a predicate — no scheduler is built or implied.
 */

const DETECTED = new Date("2026-07-01T00:00:00Z");
const NOW = new Date("2026-07-06T00:00:00Z");

function signal(
  kind: SignalRow["kind"],
  expiresAt: Date | null,
  detectedAt: Date = DETECTED,
  evidenceId = `ev-${kind}`,
): SignalRow {
  return {
    kind,
    signalSource: "adzuna",
    detectedAt,
    expiresAt,
    confidence: 0.9,
    evidence: {
      id: evidenceId,
      sourceUrl: `https://source.example/${kind}`,
      snippet: "hiring a patient coordinator",
      detectedAt,
      confidence: 0.9,
    },
  };
}

const LIVE = new Date("2026-07-31T00:00:00Z");
const EXPIRED = new Date("2026-07-02T00:00:00Z");

function input(signals: SignalRow[]): BriefInput {
  return {
    practice: { id: "p1", name: "Metro Derm", city: "Omaha", state: "NE", vertical: "dermatology" },
    facts: [],
    signals,
    contact: null,
    pack: getPack("dermatology"),
  };
}

const VOICE: VoiceBrief = {
  headline: "They are hiring for the front desk",
  headlineEvidenceIds: [],
  callOpener: "Your phones are winning.",
  callOpenerEvidenceIds: [],
  personalizationSnippet: "You have been in Omaha a long time.",
  personalizationEvidenceIds: [],
  sequence: {
    touches: [
      { touchNumber: 1, channel: "email", subject: "a", body: "a", evidenceIds: [] },
      { touchNumber: 2, channel: "call", subject: "b", body: "b", evidenceIds: [] },
      { touchNumber: 3, channel: "email", subject: "c", body: "c", evidenceIds: [] },
    ],
    namedCta: "Book a call",
  },
  discoveryQuestions: ["What happens at lunch?", "Who covers the desk?"],
  objections: [
    { objection: "a", rebuttal: "a" },
    { objection: "b", rebuttal: "b" },
    { objection: "c", rebuttal: "c" },
  ],
};

describe("liveSignalView", () => {
  it("counts distinct KINDS, not evidence rows", () => {
    // Three job postings are one buying moment. Counting rows would rank a practice with
    // three ads above a practice with three different signals, inverting the whole thesis.
    const rows = [
      signal("staffing_spike", LIVE, DETECTED, "a"),
      signal("staffing_spike", LIVE, DETECTED, "b"),
      signal("staffing_spike", LIVE, DETECTED, "c"),
    ];
    expect(liveSignalView(rows, NOW).signalCount).toBe(1);
    expect(liveSignalView(rows, NOW).firedSignals).toHaveLength(3);
  });

  it("excludes an expired signal from the count and the list", () => {
    const rows = [signal("staffing_spike", LIVE), signal("phone_complaints", EXPIRED)];
    const view = liveSignalView(rows, NOW);
    expect(view.signalCount).toBe(1);
    expect(view.firedSignals.map((s) => s.kind)).toEqual(["staffing_spike"]);
  });

  it("deep-links each fired signal to the sentence that fired it", () => {
    const view = liveSignalView([signal("staffing_spike", LIVE)], NOW);
    expect(view.firedSignals[0].href).toContain(":~:text=");
  });

  it("decays a signal's weight as it ages, reaching zero at expiry", () => {
    const fresh = liveSignalView([signal("staffing_spike", LIVE, NOW)], NOW);
    expect(fresh.firedSignals[0].freshnessWeight).toBe(1);
    const halfway = liveSignalView(
      [signal("staffing_spike", new Date("2026-07-11T00:00:00Z"), new Date("2026-07-01T00:00:00Z"))],
      new Date("2026-07-06T00:00:00Z"),
    );
    expect(halfway.firedSignals[0].freshnessWeight).toBeCloseTo(0.5, 6);
  });

  it("reports no freshness at all when nothing is firing", () => {
    expect(liveSignalView([], NOW)).toMatchObject({
      signalCount: 0,
      freshness: null,
      mostRecentDetectedAt: null,
    });
  });

  it("takes freshness from the freshest evidence, not the oldest", () => {
    const rows = [
      signal("staffing_spike", LIVE, new Date("2026-06-01T00:00:00Z")),
      signal("phone_complaints", LIVE, new Date("2026-07-06T00:00:00Z")),
    ];
    expect(liveSignalView(rows, NOW).freshness).toBe("today");
  });
});

describe("freshnessTier", () => {
  it("reads as a human badge, not a raw age", () => {
    expect(freshnessTier(new Date("2026-07-05T23:00:00Z"), NOW)).toBe("today");
    expect(freshnessTier(new Date("2026-07-03T00:00:00Z"), NOW)).toBe("this-week");
    expect(freshnessTier(new Date("2026-06-20T00:00:00Z"), NOW)).toBe("this-month");
    expect(freshnessTier(new Date("2026-05-01T00:00:00Z"), NOW)).toBe("ageing");
  });
});

describe("renderBrief", () => {
  it("never reads the signal count from the stored brief", () => {
    const { factual } = assembleFactual(input([signal("staffing_spike", LIVE), signal("phone_complaints", LIVE)]), NOW);
    // The brief was written when TWO signals were firing...
    expect(factual.signalFingerprint).toHaveLength(2);

    // ...and one has since expired. The card must say one, not two.
    const later = new Date("2026-08-15T00:00:00Z");
    const rows = [signal("staffing_spike", LIVE), signal("phone_complaints", new Date("2026-09-29T00:00:00Z"))];
    const rendered = renderBrief({ factual, voice: VOICE }, rows, later);
    expect(rendered.live.signalCount).toBe(1);
    expect(rendered.live.firedSignals.map((s) => s.kind)).toEqual(["phone_complaints"]);
  });

  it("resolves the headline from the voice when a moment fired", () => {
    const { factual } = assembleFactual(input([signal("staffing_spike", LIVE)]), NOW);
    expect(renderBrief({ factual, voice: VOICE }, [signal("staffing_spike", LIVE)], NOW).headline).toBe(
      "They are hiring for the front desk",
    );
  });

  it("falls back to the deterministic constant on the zero-signal variant", () => {
    const { factual } = assembleFactual(input([]), NOW);
    const zeroVoice: VoiceBrief = { ...VOICE, headline: null };
    expect(renderBrief({ factual, voice: zeroVoice }, [], NOW).headline).toBe(
      "No buying moment detected yet",
    );
  });

  it("shows the constant even if a zero-signal brief somehow carries a voice headline (P1-1 belt)", () => {
    // The synthesizer's closure gate makes this brief unwritable. render.ts is the belt: if
    // one ever slipped past — a hand-edited row, a schema bump — the card must still not
    // render a moment on a practice that had none. `factual.zeroSignal` wins over the prose.
    const { factual } = assembleFactual(input([]), NOW);
    expect(factual.zeroSignal).toBe(true);
    const rendered = renderBrief({ factual, voice: VOICE }, [], NOW);
    expect(rendered.headline).toBe("No buying moment detected yet");
  });

  it("drops back to the constant once every signal has expired (P1-2, the KTD)", () => {
    // Written when a moment WAS firing, opened after it aged out. The headline is the loudest
    // claim on the card and must not outlive its evidence.
    const { factual } = assembleFactual(input([signal("staffing_spike", LIVE)]), NOW);
    expect(factual.zeroSignal).toBe(false);
    const afterExpiry = new Date("2026-10-01T00:00:00Z");
    const rendered = renderBrief({ factual, voice: VOICE }, [signal("staffing_spike", LIVE)], afterExpiry);
    expect(rendered.live.signalCount).toBe(0);
    expect(rendered.headline).toBe("No buying moment detected yet");
    expect(rendered.stale).toBe(true);
  });

  it("is not stale, and keeps the moment, while its signals are still live", () => {
    const rows = [signal("staffing_spike", LIVE)];
    const { factual } = assembleFactual(input(rows), NOW);
    const rendered = renderBrief({ factual, voice: VOICE }, rows, NOW);
    expect(rendered.stale).toBe(false);
    expect(rendered.headline).toBe("They are hiring for the front desk");
  });
});

describe("isBriefStale", () => {
  it("is false when the fresh signal set is unchanged", () => {
    const rows = [signal("staffing_spike", LIVE)];
    const { factual } = assembleFactual(input(rows), NOW);
    expect(isBriefStale(factual, rows, NOW)).toBe(false);
  });

  it("is true when a new signal fires", () => {
    const before = [signal("staffing_spike", LIVE)];
    const { factual } = assembleFactual(input(before), NOW);
    expect(isBriefStale(factual, [...before, signal("phone_complaints", LIVE)], NOW)).toBe(true);
  });

  it("is true when a signal expires — no scheduler, just a clock and a compare", () => {
    const rows = [signal("staffing_spike", LIVE), signal("phone_complaints", LIVE)];
    const { factual } = assembleFactual(input(rows), NOW);
    // Same rows, later clock. One has aged out of its window.
    const afterExpiry = new Date("2026-08-01T00:00:00Z");
    expect(isBriefStale(factual, rows, afterExpiry)).toBe(true);
  });

  it("is not confused by row order", () => {
    const a = signal("staffing_spike", LIVE);
    const b = signal("phone_complaints", LIVE);
    const { factual } = assembleFactual(input([a, b]), NOW);
    expect(isBriefStale(factual, [b, a], NOW)).toBe(false);
  });

  it("distinguishes a replaced signal from an unchanged one, even at the same count", () => {
    const before = [signal("staffing_spike", LIVE, DETECTED, "old")];
    const { factual } = assembleFactual(input(before), NOW);
    const after = [signal("staffing_spike", LIVE, DETECTED, "new")];
    expect(isBriefStale(factual, after, NOW)).toBe(true);
  });
});

describe("nextExpiryAt", () => {
  it("returns the earliest expiry among fresh signals", () => {
    const rows = [
      signal("phone_complaints", new Date("2026-09-29T00:00:00Z")),
      signal("staffing_spike", new Date("2026-07-31T00:00:00Z")),
    ];
    expect(nextExpiryAt(rows, NOW)).toEqual(new Date("2026-07-31T00:00:00Z"));
  });

  it("is null when nothing is firing", () => {
    expect(nextExpiryAt([], NOW)).toBeNull();
  });

  it("is null when no fresh signal carries an expiry", () => {
    expect(nextExpiryAt([signal("growth_events", null)], NOW)).toBeNull();
  });
});
