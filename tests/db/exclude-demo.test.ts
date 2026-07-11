import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../setup";
import { upsertPractice, upsertSignal } from "@/db/ingest";
import {
  costByVertical,
  cycleRows,
  excludeDemoPractices,
  feedPractices,
  feedbackRows,
  isDemoGeoKey,
  practiceSignalKinds,
  roiEventRows,
  sequenceTouchRows,
} from "@/db/queries";
import {
  briefs,
  costEvents,
  crmLinks,
  evidence,
  feedback,
  roiEvents,
  sequences,
} from "@/db/schema";

/**
 * The seed-exclusion contract (D9 · ROI honesty): the live `/feed` and `/scoreboard`
 * read ONLY the real pipeline. A seeded practice carries a `demo:` geo-key prefix; the
 * real pipeline never does. Every real-facing query that reads `practices` filters
 * through the single `excludeDemoPractices` fragment.
 *
 * This suite plants ONE real practice and ONE demo practice, each with the SAME
 * dependent rows, and proves: demo rows are excluded, the real row survives, and a
 * null-practice infra cost row still counts. `NOW` is fixed so the fresh signal never
 * ages out on a real calendar date. Every name here is invented for this file.
 */
const NOW = new Date("2026-07-09T00:00:00Z");
const FUTURE = new Date("2026-08-09T00:00:00Z"); // fresh window open

describe("isDemoGeoKey (pure predicate)", () => {
  it("flags demo: keys and clears real ones", () => {
    expect(isDemoGeoKey("demo:gen-0000")).toBe(true);
    expect(isDemoGeoKey("demo:cedarline-austin-tx")).toBe(true);
    expect(isDemoGeoKey("austin-tx")).toBe(false);
    expect(isDemoGeoKey("real:demo-ish")).toBe(false); // prefix must be at the START
    expect(isDemoGeoKey(null)).toBe(false);
    expect(isDemoGeoKey(undefined)).toBe(false);
  });
});

describe("real-facing queries exclude demo: practices", () => {
  let t: TestDb;
  let realId: string;
  let demoId: string;

  beforeEach(async () => {
    t = await createTestDb();

    // Two practices, same shape — one real, one seeded.
    const real = await upsertPractice(t.db, {
      name: "Real Derm Group",
      geoKey: "austin-tx",
      vertical: "dermatology",
    });
    const demo = await upsertPractice(t.db, {
      name: "Seeded Derm Group",
      geoKey: "demo:gen-0000",
      vertical: "dermatology",
    });
    realId = real.id;
    demoId = demo.id;

    // A fresh signal apiece (evidence + signal), so both would otherwise reach the feed.
    for (const [pid, url] of [
      [realId, "https://real.example/jobs"],
      [demoId, "https://demo.example/jobs"],
    ] as const) {
      const [ev] = await t.db
        .insert(evidence)
        .values({ sourceUrl: url, detectedAt: NOW })
        .returning({ id: evidence.id });
      await upsertSignal(t.db, {
        practiceId: pid,
        kind: "staffing_spike",
        evidenceId: ev.id,
        detectedAt: NOW,
        expiresAt: FUTURE,
      });
    }

    // The same funnel/activity/verdict/cost rows for each practice.
    for (const pid of [realId, demoId]) {
      await t.db.insert(roiEvents).values([
        { eventType: "lead_pushed", practiceId: pid, vertical: "dermatology", payload: { cohort: "buying_moment" } },
        { eventType: "meeting_booked", practiceId: pid, payload: {} },
      ]);
      await t.db.insert(feedback).values({ practiceId: pid, aeEmail: "ae@demo.test", thumb: "up" });
      await t.db.insert(crmLinks).values({ practiceId: pid, provider: "hubspot", stage: "appointmentscheduled", cycleTimeDays: "30" });
      const [brief] = await t.db.insert(briefs).values({ practiceId: pid }).returning({ id: briefs.id });
      await t.db.insert(sequences).values([
        { briefId: brief.id, touchNumber: 1, channel: "email", body: "a", cta: "book" },
        { briefId: brief.id, touchNumber: 2, channel: "email", body: "b", cta: "book" },
      ]);
    }

    // Distinct cost per practice so a leak would show, plus an unattributed infra row.
    await t.db.insert(costEvents).values([
      { provider: "anthropic", operation: "messages", pipelineStep: "enrich", practiceId: realId, units: "1", unitCostUsd: "5", costUsd: "5" },
      { provider: "anthropic", operation: "messages", pipelineStep: "enrich", practiceId: demoId, units: "1", unitCostUsd: "99", costUsd: "99" },
      { provider: "vercel", operation: "infra", pipelineStep: "host", practiceId: null, units: "1", unitCostUsd: "7", costUsd: "7" },
    ]);
  });

  afterEach(async () => {
    await t.close();
  });

  it("feedPractices returns the real practice and drops the demo one", async () => {
    const feed = await feedPractices(t.db, NOW);
    expect(feed.map((r) => r.id)).toEqual([realId]);
    expect(feed.map((r) => r.name)).not.toContain("Seeded Derm Group");
  });

  it("roiEventRows carries only the real practice's funnel events", async () => {
    const rows = await roiEventRows(t.db);
    expect(rows.every((r) => r.practiceId === realId)).toBe(true);
    expect(rows.some((r) => r.practiceId === demoId)).toBe(false);
    // Both funnel events for the real practice survived (2), demo's did not.
    expect(rows).toHaveLength(2);
  });

  it("feedbackRows, cycleRows, practiceSignalKinds, sequenceTouchRows all drop demo", async () => {
    expect(await feedbackRows(t.db)).toHaveLength(1);
    expect(await cycleRows(t.db)).toHaveLength(1);

    const kinds = await practiceSignalKinds(t.db);
    expect(kinds.map((k) => k.practiceId)).toEqual([realId]);

    const seqs = await sequenceTouchRows(t.db);
    // One brief for the real practice; demo's brief/sequence excluded.
    expect(seqs).toHaveLength(1);
    expect(seqs[0].touches).toBe(2);
  });

  it("costByVertical excludes demo spend but KEEPS unattributed infra spend", async () => {
    const rows = await costByVertical(t.db);
    const byVertical = new Map(rows.map((r) => [r.vertical, r.costUsd]));
    // dermatology = real only ($5), NOT $5 + $99 — the demo spend never leaks in.
    expect(byVertical.get("dermatology")).toBe(5);
    // The null-practice infra row (no practice to be "demo") still counts.
    expect(byVertical.get(null)).toBe(7);
  });

  it("exposes a reusable SQL fragment (single source of truth)", () => {
    // The fragment is defined (not accidentally undefined), so every query shares it.
    expect(excludeDemoPractices).toBeDefined();
  });
});
