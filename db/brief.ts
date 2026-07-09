import { eq } from "drizzle-orm";
import { briefs } from "./schema";
import type { Database } from "./types";
import { BRIEF_SCHEMA_VERSION } from "@/src/brief/config";
import {
  factualBriefSchema,
  voiceBriefSchema,
  type FactualBrief,
  type StoredBrief,
  type VoiceBrief,
} from "@/src/brief/schema";

/**
 * Brief persistence (U6). `briefs.practice_id` is UNIQUE, so a practice has exactly one
 * brief and a regeneration UPDATES it in place rather than accumulating versions.
 *
 * This is the ONE place in the repo where an `ON CONFLICT DO UPDATE` is correct rather
 * than forbidden. R17's rule — "never blindly overwrite a real record" — protects
 * OBSERVATIONS: a `practice_facts` row is a citation the AE may already have clicked, and
 * clobbering it would move the ground under a claim they read. A brief is DERIVED: it is a
 * pure function of the facts, the pack, and the signals that were firing. Regenerating it
 * is the intended behaviour, and refusing the write would leave an AE reading prose about
 * a buying moment that has since expired. The distinction is raw-vs-derived, and it is the
 * same line R17 draws everywhere else.
 *
 * `generated_at` records the first write and never moves. `regenerated_at` records the
 * latest, and is null until a brief is rewritten — so "has this ever been regenerated, and
 * when" is answerable from the row without an audit table.
 */

export interface UpsertBriefArgs {
  practiceId: string;
  factual: FactualBrief;
  voice: VoiceBrief;
  /** Injected clock — provenance timestamps must be reproducible in tests. */
  now: Date;
}

export type UpsertBriefResult = {
  briefId: string;
  status: "generated" | "regenerated";
};

/**
 * Write the brief, atomically. Returns which of the two things happened, because they mean
 * different things to the ROI scoreboard: a `regenerated` brief spent a second Opus call on
 * a practice that had already been briefed once.
 *
 * ONE statement, not a SELECT then an INSERT-or-UPDATE. Under a parallel seeding run (U15
 * briefs a whole metro) two workers reaching the same practice would both read "missing",
 * both INSERT, and one would die on the `practice_id` unique constraint — after paying for
 * its Opus call. `ON CONFLICT DO UPDATE` lets Postgres settle it.
 *
 * The insert leaves `regenerated_at` NULL; the conflict path sets it. So the returned row
 * distinguishes the two cases with no second query and no race of its own: a non-null
 * `regenerated_at` means the update branch ran.
 */
export async function upsertBrief(
  db: Database,
  args: UpsertBriefArgs,
): Promise<UpsertBriefResult> {
  const [row] = await db
    .insert(briefs)
    .values({
      practiceId: args.practiceId,
      factual: args.factual,
      voice: args.voice,
      schemaVersion: BRIEF_SCHEMA_VERSION,
      generatedAt: args.now,
    })
    .onConflictDoUpdate({
      target: briefs.practiceId,
      set: {
        factual: args.factual,
        voice: args.voice,
        schemaVersion: BRIEF_SCHEMA_VERSION,
        // `generated_at` is deliberately absent from `set`: the FIRST generation keeps its
        // timestamp forever, and `regenerated_at` carries the latest. "Has this ever been
        // rewritten, and when" is answerable from the row without an audit table.
        regeneratedAt: args.now,
      },
    })
    .returning({ id: briefs.id, regeneratedAt: briefs.regeneratedAt });

  return {
    briefId: row.id,
    status: row.regeneratedAt === null ? "generated" : "regenerated",
  };
}

export type GetBriefResult =
  | { status: "found"; brief: StoredBrief; briefId: string }
  | { status: "missing" }
  /**
   * A row exists whose JSON no longer parses — a schema change shipped without a
   * migration, or a hand-edited row. LOUD, and never folded into `missing`: "we have no
   * brief" and "we have a brief we can no longer read" call for different fixes, and
   * reporting our own bug as absent data produced a false finding in U5 once already.
   */
  | { status: "unreadable"; reason: string; briefId: string };

/**
 * Read the stored brief, re-validating both tiers against the current schema.
 *
 * jsonb columns are `unknown` at the type level and `any` at the database level. Trusting
 * the shape because we wrote it is how a schema bump becomes a runtime crash in a UI route
 * six units downstream. Parse on the way out, every time; it costs microseconds.
 */
export async function getBrief(db: Database, practiceId: string): Promise<GetBriefResult> {
  const [row] = await db
    .select({
      id: briefs.id,
      factual: briefs.factual,
      voice: briefs.voice,
    })
    .from(briefs)
    .where(eq(briefs.practiceId, practiceId))
    .limit(1);

  if (!row) return { status: "missing" };

  const factual = factualBriefSchema.safeParse(row.factual);
  const voice = voiceBriefSchema.safeParse(row.voice);
  if (!factual.success || !voice.success) {
    const issues = [...(factual.error?.issues ?? []), ...(voice.error?.issues ?? [])]
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    return { status: "unreadable", reason: issues, briefId: row.id };
  }

  return {
    status: "found",
    briefId: row.id,
    brief: { factual: factual.data, voice: voice.data },
  };
}
