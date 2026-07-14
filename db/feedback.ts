import { sql } from "drizzle-orm";
import { feedback } from "@/db/schema";
import type { Database } from "@/db/types";

/**
 * AE lead-quality feedback write path (R13). The `/api/feedback` route persists here.
 * A re-vote by the same AE on the same practice UPDATES the existing row (the
 * `feedback_practice_ae_uq` unique constraint), so a vote is idempotent per (practice, AE).
 */

export type FeedbackThumb = "up" | "down";
export type FeedbackReason =
  | "too_small"
  | "wrong_specialty"
  | "already_customer"
  | "bad_timing";

export interface FeedbackInput {
  practiceId: string;
  aeEmail: string;
  thumb: FeedbackThumb;
  reason?: FeedbackReason | null;
  freeText?: string | null;
}

export async function recordFeedback(db: Database, input: FeedbackInput): Promise<void> {
  await db
    .insert(feedback)
    .values({
      practiceId: input.practiceId,
      aeEmail: input.aeEmail,
      thumb: input.thumb,
      reason: input.reason ?? null,
      freeText: input.freeText ?? null,
    })
    .onConflictDoUpdate({
      target: [feedback.practiceId, feedback.aeEmail],
      // Only overwrite reason/freeText when the caller actually supplied them, so a
      // thumb-only re-vote preserves prior context; an explicit null still clears.
      set: {
        thumb: input.thumb,
        ...(input.reason !== undefined ? { reason: input.reason } : {}),
        ...(input.freeText !== undefined ? { freeText: input.freeText } : {}),
        updatedAt: sql`now()`,
      },
    });
}
