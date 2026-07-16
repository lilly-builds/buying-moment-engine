import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  claimEngineRun,
  completeEngineRun,
  ENGINE_RUN_STALE_AFTER_MS,
  ENGINE_RUN_TIMEOUT_ERROR,
  failEngineRun,
  isEngineRunStale,
  reconcileStaleEngineRuns,
  startEngineRun,
} from "@/db/engine-runs";
import { engineRuns } from "@/db/schema";
import { createTestDb, type TestDb } from "../setup";

describe("engine run receipts", () => {
  let t: TestDb;

  beforeEach(async () => {
    t = await createTestDb();
  });
  afterEach(async () => {
    await t.close();
  });

  it("does not confuse a healthy in-flight invocation with a killed run", async () => {
    const id = await startEngineRun(t.db, "downstream");
    const [row] = await t.db
      .select()
      .from(engineRuns)
      .where(eq(engineRuns.id, id));

    expect(row.status).toBe("running");
    expect(row.finishedAt).toBeNull();
    expect(row.summary).toBeNull();
    expect(
      isEngineRunStale(row, new Date(row.startedAt.getTime() + 300_000)),
    ).toBe(false);
    expect(
      isEngineRunStale(
        row,
        new Date(row.startedAt.getTime() + ENGINE_RUN_STALE_AFTER_MS + 1),
      ),
    ).toBe(true);
  });

  it("starts durably and stores the completed summary", async () => {
    const id = await startEngineRun(t.db, "downstream");
    await completeEngineRun(t.db, id, { briefed: 1, pending: 2 });

    const [row] = await t.db
      .select()
      .from(engineRuns)
      .where(eq(engineRuns.id, id));
    expect(row.status).toBe("completed");
    expect(row.phase).toBe("downstream");
    expect(row.finishedAt).toBeInstanceOf(Date);
    expect(row.summary).toEqual({ briefed: 1, pending: 2 });
  });

  it("stores setup failures instead of losing the invocation", async () => {
    const id = await startEngineRun(t.db, "sources");
    await failEngineRun(t.db, id, "provider key failed");

    const [row] = await t.db
      .select()
      .from(engineRuns)
      .where(eq(engineRuns.id, id));
    expect(row.status).toBe("failed");
    expect(row.error).toBe("provider key failed");
  });

  it("atomically rejects a second in-flight run for the same phase", async () => {
    const first = await claimEngineRun(t.db, "downstream");
    const duplicate = await claimEngineRun(t.db, "downstream");

    expect(first).toBeTruthy();
    expect(duplicate).toBeNull();
  });

  it("reconciles a timed-out receipt so the next invocation can claim the phase", async () => {
    const id = await startEngineRun(t.db, "downstream");
    const now = new Date("2026-07-16T14:00:00Z");
    await t.db
      .update(engineRuns)
      .set({
        startedAt: new Date(now.getTime() - ENGINE_RUN_STALE_AFTER_MS - 1),
      })
      .where(eq(engineRuns.id, id));

    expect(await reconcileStaleEngineRuns(t.db, now)).toBe(1);
    const [timedOut] = await t.db
      .select()
      .from(engineRuns)
      .where(eq(engineRuns.id, id));
    expect(timedOut.status).toBe("failed");
    expect(timedOut.error).toBe(ENGINE_RUN_TIMEOUT_ERROR);
    expect(await claimEngineRun(t.db, "downstream")).toBeTruthy();
  });

  it.each([
    {
      name: "exactly at the stale boundary",
      status: "running" as const,
      finishedAt: null,
      elapsed: ENGINE_RUN_STALE_AFTER_MS,
    },
    {
      name: "already completed",
      status: "completed" as const,
      finishedAt: new Date("2026-07-16T13:00:00Z"),
      elapsed: ENGINE_RUN_STALE_AFTER_MS + 1,
    },
    {
      name: "running label with a finish timestamp",
      status: "running" as const,
      finishedAt: new Date("2026-07-16T13:00:00Z"),
      elapsed: ENGINE_RUN_STALE_AFTER_MS + 1,
    },
  ])("does not mark $name as stale", ({ status, finishedAt, elapsed }) => {
    const startedAt = new Date("2026-07-16T12:00:00Z");
    expect(
      isEngineRunStale(
        { status, startedAt, finishedAt },
        new Date(startedAt.getTime() + elapsed),
      ),
    ).toBe(false);
  });
});
