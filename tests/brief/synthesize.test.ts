import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getBrief } from "@/db/brief";
import { PIPELINE_STEP_BRIEF } from "@/src/brief/config";
import { citationClosure, headlineCitesASignal, synthesizeBrief } from "@/src/brief/synthesize";
import type { VoiceRequest } from "@/src/brief/prompts/voice";
import { renderBrief } from "@/src/brief/render";
import { buildBriefInput } from "@/src/brief/inputs";
import { recordingMeter } from "../enrich/doubles";
import { createTestDb, type TestDb } from "../setup";
import { FakeVoiceClient, malformedVoiceClient } from "./doubles";
import { NOW, goodVoice, seedGoldenPractice } from "./fixtures/golden";

/**
 * U6's plan-spec'd test scenarios, driven end to end through `synthesizeBrief` against real
 * Postgres (PGlite) with only the Anthropic seam faked. Nothing here reaches around the
 * orchestrator to assert on a helper — the retry loop, the three gates, the persistence and
 * the cost meter all run.
 */

const now = () => NOW;
const quiet = () => {};

function deps(t: TestDb, client: Parameters<typeof synthesizeBrief>[0]["client"]) {
  const meter = recordingMeter();
  return {
    deps: { db: t.db, client, meter: meter.meter, now, logger: quiet },
    rows: meter.rows,
  };
}

describe("synthesizeBrief", () => {
  let t: TestDb;
  beforeEach(async () => {
    t = await createTestDb();
  });
  afterEach(async () => {
    await t.close();
  });

  // ─── scenario 1: golden fixture -> schema-valid, every claim cites a real evidence id ──
  it("produces a schema-valid brief whose every citation is an evidence id from its input", async () => {
    const ids = await seedGoldenPractice(t.db);
    const { deps: d } = deps(t, FakeVoiceClient.always(goodVoice));

    const result = await synthesizeBrief(d, ids.practiceId);
    expect(result.status).toBe("generated");
    if (result.status === "failed") throw new Error(result.reason);
    expect(result.attempts).toBe(1);
    expect(result.signalCount).toBe(2);
    expect(result.contactVariant).toBe("named");

    const stored = await getBrief(t.db, ids.practiceId);
    expect(stored.status).toBe("found");
    if (stored.status !== "found") throw new Error("brief not stored");

    // Citation closure, re-derived from the DB rather than from the fake's memory.
    const built = await buildBriefInput(t.db, ids.practiceId);
    if (!built.ok) throw new Error(built.reason);
    const allowed = new Set([
      ...built.input.facts.map((f) => f.evidence.id),
      ...built.input.signals.map((s) => s.evidence.id),
    ]);
    expect(citationClosure(stored.brief.voice, allowed)).toEqual([]);

    // Every deterministic claim carries its evidence id and a real source URL.
    for (const claim of stored.brief.factual.profile) {
      expect(allowed.has(claim.evidenceId)).toBe(true);
      expect(claim.sourceUrl).toMatch(/^https:\/\//);
    }
  });

  // ─── scenario 2: the claim is supported by its snippet, not merely linked to a page ────
  it("deep-links each claim into the sentence that proves it, not just to the page", async () => {
    const ids = await seedGoldenPractice(t.db);
    const { deps: d } = deps(t, FakeVoiceClient.always(goodVoice));
    await synthesizeBrief(d, ids.practiceId);

    const stored = await getBrief(t.db, ids.practiceId);
    if (stored.status !== "found") throw new Error("brief not stored");

    const specialty = stored.brief.factual.profile.find((c) => c.label === "Specialty");
    expect(specialty).toBeDefined();
    // The href carries a scroll-to-text fragment, and decoding it returns the exact quote.
    // That is the strongest grounding a machine can assert: one click lands the AE on the
    // sentence. Whether the sentence SUPPORTS the claim is the human review at U15.
    const directive = specialty!.href.split(":~:text=")[1];
    expect(directive).toBeDefined();
    const decoded = decodeURIComponent(directive!.replace(/%2D/g, "-"));
    expect(specialty!.quote).toContain(decoded);
  });

  // ─── scenario 3: absent evidence -> field omitted, never invented ──────────────────────
  it("omits incumbent tooling entirely when no evidence names it", async () => {
    const ids = await seedGoldenPractice(t.db);
    const { deps: d } = deps(t, FakeVoiceClient.always(goodVoice));
    await synthesizeBrief(d, ids.practiceId);

    const stored = await getBrief(t.db, ids.practiceId);
    if (stored.status !== "found") throw new Error("brief not stored");
    // The golden practice publishes no EHR — as no practice does (U5: never found, n=7).
    // Absence renders as absence. Never "Unknown", which is a claim we cannot cite.
    expect(stored.brief.factual.incumbentTooling).toEqual([]);
  });

  // ─── scenario 4: exactly three touches plus a named CTA ────────────────────────────────
  it("rejects a sequence that does not carry exactly three ordered touches", async () => {
    const ids = await seedGoldenPractice(t.db);
    const twoTouches = (req: VoiceRequest) => {
      const voice = goodVoice(req);
      return { ...voice, sequence: { ...voice.sequence, touches: voice.sequence.touches.slice(0, 2) } };
    };
    const { deps: d, rows } = deps(t, FakeVoiceClient.always(twoTouches));

    const result = await synthesizeBrief(d, ids.practiceId);
    expect(result).toMatchObject({ status: "failed", gate: "shape", attempts: 2 });
    // Both attempts were billed. A shape failure does not un-spend the money.
    expect(rows).toHaveLength(2);
  });

  it("rejects touches numbered out of order, which a bare length check would pass", async () => {
    const ids = await seedGoldenPractice(t.db);
    const misordered = (req: VoiceRequest) => {
      const voice = goodVoice(req);
      const [a, b, c] = voice.sequence.touches;
      return { ...voice, sequence: { ...voice.sequence, touches: [c, b, a] } };
    };
    const { deps: d } = deps(t, FakeVoiceClient.always(misordered));
    const result = await synthesizeBrief(d, ids.practiceId);
    expect(result).toMatchObject({ status: "failed", gate: "shape" });
  });

  // ─── scenario 6: no findable contact -> role-only, never a failure ─────────────────────
  it("degrades to the role-only contact variant rather than failing", async () => {
    const ids = await seedGoldenPractice(t.db, { namedContact: false });
    const { deps: d } = deps(t, FakeVoiceClient.always(goodVoice));

    const result = await synthesizeBrief(d, ids.practiceId);
    expect(result).toMatchObject({ status: "generated", contactVariant: "role_only" });

    const stored = await getBrief(t.db, ids.practiceId);
    if (stored.status !== "found") throw new Error("brief not stored");
    expect(stored.brief.factual.contact).toMatchObject({ variant: "role_only", name: null });
    // The buttons still work: a people-search scoped to the practice, not a dead link.
    expect(stored.brief.factual.contact!.linkedinHref).toContain("linkedin.com/search");
    expect(stored.brief.factual.contact!.facebookHref).toContain("facebook.com/search");
  });

  it("handles a practice with no contact row at all", async () => {
    const ids = await seedGoldenPractice(t.db, { withContact: false });
    const { deps: d } = deps(t, FakeVoiceClient.always(goodVoice));
    const result = await synthesizeBrief(d, ids.practiceId);
    expect(result).toMatchObject({ status: "generated", contactVariant: "none" });
  });

  // ─── scenario 7: zero fired signals -> the honest variant, never an invented moment ────
  it("produces the zero-signal variant, with a headline written in code", async () => {
    const ids = await seedGoldenPractice(t.db, { withSignals: false });
    const { deps: d } = deps(t, FakeVoiceClient.always(goodVoice));

    const result = await synthesizeBrief(d, ids.practiceId);
    expect(result).toMatchObject({ status: "generated", zeroSignal: true, signalCount: 0 });

    const stored = await getBrief(t.db, ids.practiceId);
    if (stored.status !== "found") throw new Error("brief not stored");
    expect(stored.brief.voice.headline).toBeNull();
    expect(stored.brief.factual.headline).toBe("No buying moment detected yet");

    const rendered = renderBrief(stored.brief, [], NOW);
    expect(rendered.headline).toBe("No buying moment detected yet");
    expect(rendered.live.signalCount).toBe(0);
  });

  it("tells the model there is no buying moment, so it cannot phrase one", async () => {
    const ids = await seedGoldenPractice(t.db, { withSignals: false });
    const client = FakeVoiceClient.always(goodVoice);
    const { deps: d } = deps(t, client);
    await synthesizeBrief(d, ids.practiceId);
    expect(client.calls[0].request.zeroSignal).toBe(true);
  });

  // ─── the citation gates ───────────────────────────────────────────────────────────────
  it("kills a brief that cites an evidence id it was never given", async () => {
    const ids = await seedGoldenPractice(t.db);
    const invented = (req: VoiceRequest) => ({
      ...goodVoice(req),
      headlineEvidenceIds: ["00000000-0000-4000-8000-000000000000"],
    });
    const { deps: d } = deps(t, FakeVoiceClient.always(invented));

    const result = await synthesizeBrief(d, ids.practiceId);
    expect(result).toMatchObject({ status: "failed", gate: "closure", attempts: 2 });
    expect(await getBrief(t.db, ids.practiceId)).toMatchObject({ status: "missing" });
  });

  it("kills a brief whose headline cites a firmographic instead of a signal", async () => {
    // Closure alone would pass this: the id is real. But the headline is the buying moment,
    // and "founded in 2004" is not one. The timing thesis is the spine of the card (D1).
    const ids = await seedGoldenPractice(t.db);
    const profileHeadline = (req: VoiceRequest) => ({
      ...goodVoice(req),
      headlineEvidenceIds: [req.facts[0].evidence.id],
    });
    const { deps: d } = deps(t, FakeVoiceClient.always(profileHeadline));

    const result = await synthesizeBrief(d, ids.practiceId);
    expect(result).toMatchObject({ status: "failed", gate: "closure" });
  });

  // ─── the truth gate + the retry ───────────────────────────────────────────────────────
  it("kills a brief that states a number the evidence never contained", async () => {
    const ids = await seedGoldenPractice(t.db);
    const fabricated = (req: VoiceRequest) => ({
      ...goodVoice(req),
      callOpener: "Your front desk misses 40% of calls.",
    });
    const { deps: d } = deps(t, FakeVoiceClient.always(fabricated));

    const result = await synthesizeBrief(d, ids.practiceId);
    expect(result).toMatchObject({ status: "failed", gate: "truth", attempts: 2 });
    expect(result.status === "failed" && result.reason).toContain("ungrounded-number");
  });

  it("retries once with the violations attached, and persists when the retry is clean", async () => {
    const ids = await seedGoldenPractice(t.db);
    const client = FakeVoiceClient.sequence([
      (req) => ({ ...goodVoice(req), callOpener: "Leverage our seamless platform." }),
      goodVoice,
    ]);
    const { deps: d, rows } = deps(t, client);

    const result = await synthesizeBrief(d, ids.practiceId);
    expect(result).toMatchObject({ status: "generated", attempts: 2 });

    // The retry is a FRESH single-turn request carrying an edit list — not a conversation.
    expect(client.calls[0].request.corrections).toEqual([]);
    const corrections = client.calls[1].request.corrections!;
    expect(corrections.join("\n")).toContain("callOpener");
    expect(corrections.join("\n")).toContain("leverage");

    // Two billed calls, two cost rows, and the attempt number is on each.
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => (r.meta as { attempt: number }).attempt)).toEqual([1, 2]);
  });

  // ─── scenario 8 / R19: every paid call is metered ─────────────────────────────────────
  it("writes a priced cost_events row for every Anthropic call", async () => {
    const ids = await seedGoldenPractice(t.db);
    const { deps: d, rows } = deps(t, FakeVoiceClient.always(goodVoice));
    await synthesizeBrief(d, ids.practiceId);

    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row.provider).toBe("anthropic");
    expect(row.operation).toBe("messages.create");
    expect(row.pipelineStep).toBe(PIPELINE_STEP_BRIEF);
    expect(row.practiceId).toBe(ids.practiceId);
    // Opus 4.8 list: $5/MTok in, $25/MTok out. 4,000 in + 900 out = 0.02 + 0.0225.
    expect(row.costUsd).toBeCloseTo(4000 * 5e-6 + 900 * 25e-6, 10);
    expect(row.costUsd).toBeGreaterThan(0);
  });

  it("still meters a billed 200 whose body is junk — the money is already gone", async () => {
    const ids = await seedGoldenPractice(t.db);
    const { deps: d, rows } = deps(t, malformedVoiceClient());

    const result = await synthesizeBrief(d, ids.practiceId);
    expect(result).toMatchObject({ status: "failed", gate: "shape" });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.costUsd > 0)).toBe(true);
  });

  // ─── inputs that must never reach a paid call ─────────────────────────────────────────
  it("refuses an unclassified practice without spending a cent", async () => {
    const ids = await seedGoldenPractice(t.db, { classify: false });
    const { deps: d, rows } = deps(t, FakeVoiceClient.always(goodVoice));

    const result = await synthesizeBrief(d, ids.practiceId);
    expect(result).toMatchObject({
      status: "failed",
      gate: "input",
      reason: "unclassified-vertical",
      attempts: 0,
    });
    expect(rows).toEqual([]);
  });

  it("refuses an unknown practice id without spending a cent", async () => {
    const { deps: d, rows } = deps(t, FakeVoiceClient.always(goodVoice));
    const result = await synthesizeBrief(d, "00000000-0000-4000-8000-000000000000");
    expect(result).toMatchObject({ status: "failed", gate: "input", reason: "practice-not-found" });
    expect(rows).toEqual([]);
  });

  // ─── persistence ──────────────────────────────────────────────────────────────────────
  it("regenerates in place rather than accumulating briefs", async () => {
    const ids = await seedGoldenPractice(t.db);
    const { deps: d } = deps(t, FakeVoiceClient.always(goodVoice));

    const first = await synthesizeBrief(d, ids.practiceId);
    const second = await synthesizeBrief(d, ids.practiceId);
    expect(first.status).toBe("generated");
    expect(second.status).toBe("regenerated");
    if (first.status === "failed" || second.status === "failed") throw new Error("unexpected");
    expect(second.briefId).toBe(first.briefId);
  });
});

describe("citationClosure", () => {
  it("reports each unknown id once, however many fields cite it", () => {
    const voice = {
      headlineEvidenceIds: ["ghost"],
      callOpenerEvidenceIds: ["ghost", "real"],
      personalizationEvidenceIds: [],
      sequence: { touches: [{ evidenceIds: ["ghost"] }] },
    } as unknown as Parameters<typeof citationClosure>[0];
    expect(citationClosure(voice, new Set(["real"]))).toEqual([{ evidenceId: "ghost" }]);
  });
});

describe("headlineCitesASignal", () => {
  const signalRow = (id: string) => ({ evidence: { id } }) as never;

  it("is true when the headline names a signal's evidence", () => {
    const voice = { headlineEvidenceIds: ["sig"] } as never;
    expect(headlineCitesASignal(voice, [signalRow("sig")])).toBe(true);
  });

  it("is false when the headline names only a firmographic", () => {
    const voice = { headlineEvidenceIds: ["fact"] } as never;
    expect(headlineCitesASignal(voice, [signalRow("sig")])).toBe(false);
  });
});
