import { and, eq, isNull, lt } from "drizzle-orm";
import { engineRuns } from "./schema";
import type { Database } from "./types";

export const ENGINE_RUN_STALE_AFTER_MS = 360_000;
export const ENGINE_RUN_TIMEOUT_ERROR =
  "invocation exceeded its execution window and was reconciled by a later run";

export function isEngineRunStale(
  run: { status: string; startedAt: Date; finishedAt: Date | null },
  now: Date = new Date(),
): boolean {
  return (
    run.status === "running" &&
    run.finishedAt === null &&
    now.getTime() - run.startedAt.getTime() > ENGINE_RUN_STALE_AFTER_MS
  );
}

export async function startEngineRun(
  db: Database,
  phase: typeof engineRuns.$inferInsert.phase,
): Promise<string> {
  const [row] = await db
    .insert(engineRuns)
    .values({ phase })
    .returning({ id: engineRuns.id });
  return row.id;
}

export async function claimEngineRun(
  db: Database,
  phase: typeof engineRuns.$inferInsert.phase,
): Promise<string | null> {
  try {
    return await startEngineRun(db, phase);
  } catch (error) {
    if (isUniqueViolation(error)) return null;
    throw error;
  }
}

function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const value = error as { code?: unknown; cause?: unknown };
  if (value.code === "23505") return true;
  return isUniqueViolation(value.cause);
}

export async function reconcileStaleEngineRuns(
  db: Database,
  now: Date = new Date(),
): Promise<number> {
  const staleBefore = new Date(now.getTime() - ENGINE_RUN_STALE_AFTER_MS);
  const rows = await db
    .update(engineRuns)
    .set({
      status: "failed",
      finishedAt: now,
      error: ENGINE_RUN_TIMEOUT_ERROR,
    })
    .where(
      and(
        eq(engineRuns.status, "running"),
        isNull(engineRuns.finishedAt),
        lt(engineRuns.startedAt, staleBefore),
      ),
    )
    .returning({ id: engineRuns.id });
  return rows.length;
}

export async function completeEngineRun(
  db: Database,
  id: string,
  summary: unknown,
): Promise<void> {
  await db
    .update(engineRuns)
    .set({
      status: "completed",
      finishedAt: new Date(),
      summary,
      error: null,
    })
    .where(eq(engineRuns.id, id));
}

export async function failEngineRun(
  db: Database,
  id: string,
  error: string,
): Promise<void> {
  await db
    .update(engineRuns)
    .set({ status: "failed", finishedAt: new Date(), error })
    .where(eq(engineRuns.id, id));
}
