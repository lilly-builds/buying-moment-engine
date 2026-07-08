import { and, eq } from "drizzle-orm";
import { upsertPractice, upsertSignal } from "@/db/ingest";
import { signalCount } from "@/db/queries";
import { evidence, practices, signals } from "@/db/schema";
import type { Database } from "@/db/types";
import type { DetectorKind } from "@/src/ingest/validate";
import { normalizeName } from "@/src/ingest/validate";

/**
 * Practice resolver (U5) — merges candidates that name the SAME practice into one
 * entity. `db/ingest.ts` deliberately resolves on an exact (normalized_name,
 * geo_key) match; that is its declared boundary. Detectors, though, see the same
 * practice spelled three ways ("Sunshine Dermatology Associates", "Sunshine
 * Dermatology Assoc.", "Sunshine Derm Associates, P.A."), and without fuzzy
 * merging each spelling becomes its own row with one signal — destroying the
 * signal count the feed ranks on (D8).
 *
 * The matching helpers are PURE (no DB), so the merge rule unit-tests with no
 * mocks. Geo is a hard gate, never fuzzy: two same-named practices in different
 * metros are different businesses, and merging them would be unrecoverable.
 */

/** Corporate/legal suffixes and filler that carry no identity. */
const NOISE_TOKENS = new Set([
  "pa",
  "pc",
  "pllc",
  "llc",
  "llp",
  "inc",
  "corp",
  "co",
  "ltd",
  "the",
  "of",
  "and",
  "at",
]);

/** Common abbreviations seen in practice names, mapped to a canonical token. */
const TOKEN_ALIASES: Record<string, string> = {
  assoc: "associates",
  assocs: "associates",
  associate: "associates",
  ctr: "center",
  centre: "center",
  ctrs: "centers",
  derm: "dermatology",
  dermatologists: "dermatology",
  ortho: "orthopedics",
  orthopaedics: "orthopedics",
  orthopaedic: "orthopedics",
  orthopedic: "orthopedics",
  ophthalmologists: "ophthalmology",
  grp: "group",
  med: "medical",
  inst: "institute",
  spec: "specialists",
  specialist: "specialists",
  srgy: "surgery",
  st: "saint",
};

/**
 * Canonical name: lowercase, punctuation stripped, legal suffixes and filler
 * dropped, common abbreviations expanded. `normalizeName` (U1) stays the DB's
 * exact-match key; this is strictly a comparison form and is never persisted.
 *
 * Single-character tokens are dropped: they are the debris of stripping the dots
 * out of "P.A." / "P.C." / "M.D.", and keeping them would make every professional
 * corporation look 40% different from its plain-named self.
 */
export function canonicalizeName(name: string): string[] {
  return normalizeName(name)
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 1)
    .map((token) => TOKEN_ALIASES[token] ?? token)
    .filter((token) => !NOISE_TOKENS.has(token));
}

/** Jaccard similarity over canonical tokens: |A ∩ B| / |A ∪ B|, in [0,1]. */
export function nameSimilarity(a: string, b: string): number {
  const setA = new Set(canonicalizeName(a));
  const setB = new Set(canonicalizeName(b));
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const token of setA) if (setB.has(token)) intersection += 1;
  const union = setA.size + setB.size - intersection;
  return intersection / union;
}

/**
 * 0.6 keeps "Sunshine Dermatology Associates" ~ "Sunshine Derm Assoc." (3/3 after
 * canonicalization) while separating "Sunshine Dermatology" from "Sunrise
 * Dermatology" (1/3). Tuned against the fixtures in `tests/engine/resolver.test.ts`.
 */
export const NAME_MATCH_THRESHOLD = 0.6;

export interface PracticeCandidate {
  name: string;
  geoKey: string;
  city?: string | null;
  state?: string | null;
  vertical?: (typeof practices.$inferInsert)["vertical"];
}

/** Same business? Geo must match EXACTLY; only the name is fuzzy. */
export function isSameEntity(
  a: Pick<PracticeCandidate, "name" | "geoKey">,
  b: Pick<PracticeCandidate, "name" | "geoKey">,
): boolean {
  if (a.geoKey !== b.geoKey) return false;
  return nameSimilarity(a.name, b.name) >= NAME_MATCH_THRESHOLD;
}

export interface ResolvedPractice {
  practiceId: string;
  /** true = merged into an existing practice; false = a new entity was created. */
  merged: boolean;
  /** The stored name of the practice we merged into, when `merged`. */
  matchedName?: string;
}

/**
 * Resolve a candidate to exactly one practice row: fuzzy-match within the geo,
 * otherwise create. Idempotent — `upsertPractice` is ON CONFLICT DO NOTHING, and
 * a merge never rewrites the surviving practice's name (never blindly overwrite
 * a real record; the first-seen spelling wins and stays stable for the AE).
 */
export async function resolvePractice(
  db: Database,
  candidate: PracticeCandidate,
): Promise<ResolvedPractice> {
  const inGeo = await db
    .select({ id: practices.id, name: practices.name })
    .from(practices)
    .where(eq(practices.geoKey, candidate.geoKey));

  let best: { id: string; name: string; score: number } | null = null;
  for (const row of inGeo) {
    const score = nameSimilarity(candidate.name, row.name);
    if (score >= NAME_MATCH_THRESHOLD && (!best || score > best.score)) {
      best = { id: row.id, name: row.name, score };
    }
  }
  if (best) {
    return { practiceId: best.id, merged: true, matchedName: best.name };
  }

  const created = await upsertPractice(db, candidate);
  return { practiceId: created.id, merged: false };
}

export interface SignalAttachment {
  practiceId: string;
  kind: DetectorKind;
  sourceUrl: string;
  snippet?: string | null;
  confidence?: number | null;
  detectedAt: Date;
  expiresAt?: Date | null;
  signalSource?: string | null;
}

/**
 * Persist one evidence atom + its signal against an already-resolved practice.
 * Mirrors the ingest rail's promotion step so the citation contract (source URL +
 * snippet + detected_at) survives the resolver path too.
 *
 * IDEMPOTENT (R17). The ingest rail earns its idempotency upstream, from
 * `raw_signals.dedupe_hash`. This path has no raw row, so the CITATION IDENTITY is
 * the dedupe key: the same claim (`kind`) about the same practice, sourced from the
 * same page. Insert-then-upsert cannot work here — a fresh `evidence` row means a
 * fresh `evidence_id`, so `signals`' ON CONFLICT (practice_id, kind, evidence_id)
 * could never fire and every re-run would duplicate both rows. U8's pull-mode
 * re-runs the on-demand detector pass on demand, so this path WILL be re-entered.
 * The existence check and the writes share one transaction so a concurrent
 * re-entry can't interleave between them.
 */
export async function attachSignal(db: Database, args: SignalAttachment) {
  const confidence =
    args.confidence === null || args.confidence === undefined
      ? null
      : String(args.confidence);

  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(signals)
      .innerJoin(evidence, eq(signals.evidenceId, evidence.id))
      .where(
        and(
          eq(signals.practiceId, args.practiceId),
          eq(signals.kind, args.kind),
          eq(evidence.sourceUrl, args.sourceUrl),
        ),
      )
      .limit(1);
    if (existing) return existing.signals;

    const [ev] = await tx
      .insert(evidence)
      .values({
        sourceUrl: args.sourceUrl,
        snippet: args.snippet ?? null,
        confidence,
        detectedAt: args.detectedAt,
      })
      .returning({ id: evidence.id });

    return upsertSignal(tx, {
      practiceId: args.practiceId,
      kind: args.kind,
      evidenceId: ev.id,
      confidence,
      detectedAt: args.detectedAt,
      expiresAt: args.expiresAt ?? null,
      signalSource: args.signalSource ?? args.kind,
    });
  });
}

/**
 * Signal count = DISTINCT FIRED SIGNAL KINDS, not evidence rows (D8/R1). Three
 * job posts are one staffing-spike signal. Delegates to the single derived query
 * in `db/queries.ts` rather than restating the SQL (R17: one source of truth).
 */
export async function firedSignalCount(
  db: Database,
  practiceId: string,
): Promise<number> {
  return signalCount(db, practiceId);
}

/** Set the practice's vertical tag. Only ever tightens `unclassified` -> a real vertical. */
export async function tagVertical(
  db: Database,
  practiceId: string,
  vertical: (typeof practices.$inferInsert)["vertical"],
): Promise<void> {
  await db
    .update(practices)
    .set({ vertical })
    .where(
      and(eq(practices.id, practiceId), eq(practices.vertical, "unclassified")),
    );
}
