import { eq } from "drizzle-orm";
import { practices } from "./schema";
import type { Database } from "./types";

export async function markBriefAttemptStarted(
  db: Database,
  practiceId: string,
  attemptedAt: Date,
): Promise<void> {
  await db
    .update(practices)
    .set({ lastBriefAttemptAt: attemptedAt })
    .where(eq(practices.id, practiceId));
}
