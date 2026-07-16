import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getBrief } from "@/db/brief";
import { PIPELINE_STEP_BRIEF, VOICE_MAX_ATTEMPTS } from "@/src/brief/config";
import { citationClosure, headlineCitesASignal, synthesizeBrief } from "@/src/brief/synthesize";
import type { VoiceRequest } from "@/src/brief/prompts/voice";
import { renderBrief } from "@/src/brief/render";
import { buildBriefInput } from "@/src/brief/inputs";
import { AnthropicRequestError } from "@/src/enrich/types";
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
    if (result.status !== "generated" && result.status !== "regenerated") {
      throw new Error("brief was not generated");
    }
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
    expect(result).toMatchObject({ status: "failed", gate: "shape", attempts: VOICE_MAX_ATTEMPTS });
    // Every attempt was billed. A shape failure does not un-spend the money.
    expect(rows).toHaveLength(VOICE_MAX_ATTEMPTS);
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
    expect(result).toMatchObject({ status: "failed", gate: "closure", attempts: VOICE_MAX_ATTEMPTS });
    expect(await getBrief(t.db, ids.practiceId)).toMatchObject({ status: "missing" });
  });

  it("kills a zero-signal brief whose model invented a buying moment (P1-1)", async () => {
    // Zero signals, but the model returns a headline anyway, citing nothing. SHAPE passes
    // (a string is valid), CLOSURE's old id check passes ([] ⊆ allowed), TRUTH passes (no
    // digits). The variant lock is the only thing that catches it — and it must.
    const ids = await seedGoldenPractice(t.db, { withSignals: false });
    const invented = (req: VoiceRequest) => ({
      ...goodVoice(req),
      headline: "They just opened a second location",
      headlineEvidenceIds: [],
    });
    const { deps: d } = deps(t, FakeVoiceClient.always(invented));

    const result = await synthesizeBrief(d, ids.practiceId);
    expect(result).toMatchObject({ status: "failed", gate: "closure", attempts: VOICE_MAX_ATTEMPTS });
    expect(await getBrief(t.db, ids.practiceId)).toMatchObject({ status: "missing" });
  });

  it("kills a fired-signal brief whose model returned a null headline (P1-1, the inverse)", async () => {
    // A moment fired, so the card's spine is the timing thesis — a null headline would render
    // "No buying moment detected yet" over live signals, the same lie in the other direction.
    const ids = await seedGoldenPractice(t.db);
    const nulled = (req: VoiceRequest) => ({
      ...goodVoice(req),
      headline: null,
      headlineEvidenceIds: [],
    });
    const { deps: d } = deps(t, FakeVoiceClient.always(nulled));

    const result = await synthesizeBrief(d, ids.practiceId);
    expect(result).toMatchObject({ status: "failed", gate: "closure" });
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
    expect(result).toMatchObject({ status: "failed", gate: "truth", attempts: VOICE_MAX_ATTEMPTS });
    expect(result.status === "failed" && result.reason).toContain("ungrounded-number");
  });

  it("kills a brief that asserts the pack's own proof numbers about this practice (P1-3)", async () => {
    // The two-holes-into-one exploit: the dermatology pack's 2,000 calls and 250 new patients,
    // stated about the prospect in a touch body, citing nothing. Closure passes (empty ids are
    // legal on a touch), but the corpus split means the pack's numbers ground only a rebuttal.
    const ids = await seedGoldenPractice(t.db);
    const packNumbers = (req: VoiceRequest) => {
      const voice = goodVoice(req);
      const [t1, t2, t3] = voice.sequence.touches;
      return {
        ...voice,
        sequence: {
          ...voice.sequence,
          touches: [
            { ...t1, body: "You are fielding roughly 2,000 calls a month and losing 250 new patients to voicemail." },
            t2,
            t3,
          ],
        },
      };
    };
    const { deps: d } = deps(t, FakeVoiceClient.always(packNumbers));

    const result = await synthesizeBrief(d, ids.practiceId);
    expect(result).toMatchObject({ status: "failed", gate: "truth", attempts: VOICE_MAX_ATTEMPTS });
    expect(result.status === "failed" && result.reason).toContain("ungrounded-number");
    expect(await getBrief(t.db, ids.practiceId)).toMatchObject({ status: "missing" });
  });

  it("kills a brief whose personalization snippet cites no evidence at all (P1-3 belt)", async () => {
    const ids = await seedGoldenPractice(t.db);
    const uncited = (req: VoiceRequest) => ({ ...goodVoice(req), personalizationEvidenceIds: [] });
    const { deps: d } = deps(t, FakeVoiceClient.always(uncited));

    const result = await synthesizeBrief(d, ids.practiceId);
    expect(result).toMatchObject({ status: "failed", gate: "closure" });
    expect(result.status === "failed" && result.reason).toContain("personalizationSnippet");
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

  it("does not start another paid retry when the invocation deadline guard closes", async () => {
    const ids = await seedGoldenPractice(t.db);
    const client = FakeVoiceClient.always((req) => ({
      ...goodVoice(req),
      callOpener: "Leverage our seamless platform.",
    }));
    const { deps: d, rows } = deps(t, client);

    const result = await synthesizeBrief(
      { ...d, canStartVoiceAttempt: (attempt: number) => attempt === 1 },
      ids.practiceId,
    );
    expect(result).toMatchObject({ status: "deferred", gate: "deadline", attempts: 1 });
    expect(client.calls).toHaveLength(1);
    expect(rows).toHaveLength(1);
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
    expect(rows).toHaveLength(VOICE_MAX_ATTEMPTS);
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

  // ─── transport failures are not the practice's fault, and are never retried ───────────
  it("does not retry an unbilled transport failure, and spends nothing on it", async () => {
    const ids = await seedGoldenPractice(t.db);
    let calls = 0;
    const rateLimited = {
      async generate(): Promise<never> {
        calls += 1;
        throw new AnthropicRequestError(429, "Too Many Requests");
      },
    };
    const { deps: d, rows } = deps(t, rateLimited);

    const result = await synthesizeBrief(d, ids.practiceId);
    expect(result).toMatchObject({ status: "failed", gate: "transport", attempts: 1 });
    // Answering a 429 with a second immediate call spends money on the same 429.
    expect(calls).toBe(1);
    // A thrown call was never billed, so the meter must record nothing (R19, both ways).
    expect(rows).toEqual([]);
    expect(await getBrief(t.db, ids.practiceId)).toMatchObject({ status: "missing" });
  });

  // ─── persistence ──────────────────────────────────────────────────────────────────────
  it("regenerates in place rather than accumulating briefs", async () => {
    const ids = await seedGoldenPractice(t.db);
    const { deps: d } = deps(t, FakeVoiceClient.always(goodVoice));

    const first = await synthesizeBrief(d, ids.practiceId);
    const second = await synthesizeBrief(d, ids.practiceId);
    expect(first.status).toBe("generated");
    expect(second.status).toBe("regenerated");
    if (
      (first.status !== "generated" && first.status !== "regenerated") ||
      (second.status !== "generated" && second.status !== "regenerated")
    ) {
      throw new Error("unexpected");
    }
    expect(second.briefId).toBe(first.briefId);
  });

  it("survives two seeders racing the same practice", async () => {
    // U15 briefs a metro in parallel. A SELECT-then-INSERT would let both workers read
    // "missing", both INSERT, and one die on the practice_id unique constraint — after
    // paying for its Opus call. One statement, and Postgres settles it.
    const ids = await seedGoldenPractice(t.db);
    const { deps: d } = deps(t, FakeVoiceClient.always(goodVoice));

    const [a, b] = await Promise.all([
      synthesizeBrief(d, ids.practiceId),
      synthesizeBrief(d, ids.practiceId),
    ]);
    expect(
      [a.status, b.status].filter(
        (status) => status !== "generated" && status !== "regenerated",
      ),
    ).toEqual([]);
    if (
      (a.status !== "generated" && a.status !== "regenerated") ||
      (b.status !== "generated" && b.status !== "regenerated")
    ) {
      throw new Error("unexpected");
    }
    expect(a.briefId).toBe(b.briefId);
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
