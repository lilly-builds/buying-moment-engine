import { createHash } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import type { Database } from "./types";
import { evidence, practices, rawSignals, signals } from "./schema";
import {
  normalizeName,
  validateRawSignal,
  type DetectorKind,
} from "@/src/ingest/validate";

/**
 * Idempotent ingestion (R17). ON CONFLICT DO NOTHING on every unique key — a real
 * record is never blindly overwritten. Valid signals are promoted raw -> normalized
 * with EXACT-match resolution only; fuzzy entity resolution (`src/engine/resolver.ts`),
 * the Claude -> PDL enrichment waterfall (`src/enrich/`), and vertical
 * classification (`src/engine/verticals.ts`) are U5's job, not this rail's.
 */

export type IngestResult =
  | { status: "ingested"; practiceId: string; signalId: string }
  | { status: "duplicate" }
  | { status: "rejected"; reason: string };

export interface IngestOptions {
  /**
   * U3 freshness seam. When supplied, the promoted signal's `expires_at` is
   * computed from (kind, detectedAt) inside the same atomic promotion. Omitted
   * (the U1 default) leaves `expires_at` null. Idempotent: the expiry is a pure
   * function of its inputs, so a re-run would recompute the identical value.
   */
  computeExpiresAt?: (kind: DetectorKind, detectedAt: Date) => Date;
}

type Row = Record<string, unknown>;

function isRecord(value: unknown): value is Row {
  return typeof value === "object" && value !== null;
}

function readString(source: unknown, key: string): string | null {
  if (isRecord(source) && typeof source[key] === "string") {
    return source[key];
  }
  return null;
}

function readRecord(source: unknown, key: string): Row | null {
  if (isRecord(source) && isRecord(source[key])) {
    return source[key] as Row;
  }
  return null;
}

function readNumericAsText(source: unknown, key: string): string | null {
  if (!isRecord(source)) return null;
  const value = source[key];
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string" && value.trim() !== "") return value;
  return null;
}

function readVertical(source: unknown): UpsertPracticeArgs["vertical"] | undefined {
  const value = readString(source, "vertical");
  if (
    value === "dermatology" ||
    value === "womens_health" ||
    value === "ophthalmology" ||
    value === "orthopedics"
  ) {
    return value;
  }
  return undefined;
}

/**
 * Canonical JSON: object keys sorted at EVERY depth, arrays left in order (their
 * order is data). Two payloads that differ only in key order therefore hash
 * identically, so the fallback dedupe hash is key-order-independent — without
 * this, `{a,b}` and `{b,a}` would ingest as two distinct raw rows.
 */
function stableStringify(input: unknown): string {
  try {
    return canonicalJson(input);
  } catch {
    return String(input);
  }
}

function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Row)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`);
    return `{${entries.join(",")}}`;
  }
  // Primitives (and Date, via toJSON) round-trip through JSON.stringify.
  return JSON.stringify(value) ?? String(value);
}

function dedupeHashOf(input: unknown): string {
  const provided = readString(input, "dedupeHash");
  if (provided) return provided;
  return createHash("sha256").update(stableStringify(input)).digest("hex");
}

export async function ingestRawSignal(
  db: Database,
  input: unknown,
  options: IngestOptions = {},
): Promise<IngestResult> {
  const dedupeHash = dedupeHashOf(input);
  const validation = validateRawSignal(input);

  if (!validation.ok) {
    // Rejected rows are retained in the RAW layer for audit — never promoted.
    await db
      .insert(rawSignals)
      .values({
        dedupeHash,
        detectorKind: readString(input, "detectorKind") ?? "unknown",
        payload: readRecord(input, "payload") ?? {},
        sourceUrl: readString(input, "sourceUrl"),
        practiceHint: readString(input, "practiceHint"),
        validationStatus: "rejected",
        rejectionReason: validation.reason,
      })
      .onConflictDoNothing({ target: rawSignals.dedupeHash });
    return { status: "rejected", reason: validation.reason };
  }

  const data = validation.data;

  // Atomic raw-insert + promotion. A mid-promotion failure rolls the raw row
  // back so a retry cleanly re-promotes, instead of leaving the raw row committed
  // as `valid` (dedupe guard) with an orphaned/missing signal.
  return db.transaction(async (tx): Promise<IngestResult> => {
    const inserted = await tx
      .insert(rawSignals)
      .values({
        dedupeHash,
        detectorKind: data.detectorKind,
        payload: data.payload,
        sourceUrl: data.sourceUrl,
        practiceHint: data.practiceHint,
        detectedAt: data.detectedAt,
        validationStatus: "valid",
      })
      .onConflictDoNothing({ target: rawSignals.dedupeHash })
      .returning({ id: rawSignals.id });

    if (inserted.length === 0) return { status: "duplicate" };

    // Promote raw -> normalized (exact match). See file header for the U5 boundary.
    // A source-provided website (R-W1) rides the payload → seeds the practice at
    // creation; the upsert's ON CONFLICT DO NOTHING keeps any website already on file.
    const practice = await upsertPractice(tx, {
      name: data.practiceHint,
      geoKey: data.geoKey ?? "unknown",
      websiteUrl: readString(data.payload, "website"),
      vertical: readVertical(data.payload),
    });
    const [ev] = await tx
      .insert(evidence)
      .values({
        sourceUrl: data.sourceUrl,
        snippet: readString(data.payload, "snippet"),
        confidence: readNumericAsText(data.payload, "confidence"),
        detectedAt: data.detectedAt,
      })
      .returning({ id: evidence.id });
    const sig = await upsertSignal(tx, {
      practiceId: practice.id,
      kind: data.detectorKind,
      evidenceId: ev.id,
      detectedAt: data.detectedAt,
      expiresAt:
        options.computeExpiresAt?.(data.detectorKind, data.detectedAt) ?? null,
      signalSource: data.detectorKind,
    });
    return { status: "ingested", practiceId: practice.id, signalId: sig.id };
  });
}

export interface UpsertPracticeArgs {
  name: string;
  geoKey: string;
  city?: string | null;
  state?: string | null;
  vertical?: (typeof practices.$inferInsert)["vertical"];
  /**
   * The scrape seed (R-W1). Set ONLY when creating: the `ON CONFLICT DO NOTHING`
   * path leaves an existing practice untouched, so a re-seen lead never clobbers a
   * website already on file. Filling a previously-null website on an existing row is
   * `setPracticeWebsite`'s job (Plan B), not this one — keeping this upsert a pure
   * "create-or-return" with no hidden mutation.
   */
  websiteUrl?: string | null;
}

/** Idempotent practice upsert on (normalized_name, geo_key). */
export async function upsertPractice(db: Database, args: UpsertPracticeArgs) {
  const normalizedName = normalizeName(args.name);
  await db
    .insert(practices)
    .values({
      name: args.name,
      normalizedName,
      geoKey: args.geoKey,
      city: args.city ?? null,
      state: args.state ?? null,
      websiteUrl: args.websiteUrl ?? null,
      vertical: args.vertical ?? "unclassified",
    })
    .onConflictDoNothing({
      target: [practices.normalizedName, practices.geoKey],
    });
  const [row] = await db
    .select()
    .from(practices)
    .where(
      and(
        eq(practices.normalizedName, normalizedName),
        eq(practices.geoKey, args.geoKey),
      ),
    )
    .limit(1);
  return row;
}

/**
 * Fill a practice's website (Plan B / R-W2) WITHOUT clobbering one already on file.
 * The `IS NULL` guard is the whole point: "if the source gave us a site, keep it"
 * (D13 / R17 — never blindly overwrite a real value). A deliberate name-search fills
 * the gap; it does not overrule a website captured at the source. Returns the stored
 * website (the incoming one if it won the race, or the pre-existing one otherwise) so
 * the caller enriches from the value that actually persisted.
 */
/** Read a practice's stored website (the scrape seed), or null if none on file. */
export async function getPracticeWebsite(
  db: Database,
  practiceId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ websiteUrl: practices.websiteUrl })
    .from(practices)
    .where(eq(practices.id, practiceId))
    .limit(1);
  return row?.websiteUrl ?? null;
}

export async function setPracticeWebsite(
  db: Database,
  practiceId: string,
  websiteUrl: string,
): Promise<string | null> {
  await db
    .update(practices)
    .set({ websiteUrl })
    .where(and(eq(practices.id, practiceId), isNull(practices.websiteUrl)));
  const [row] = await db
    .select({ websiteUrl: practices.websiteUrl })
    .from(practices)
    .where(eq(practices.id, practiceId))
    .limit(1);
  return row?.websiteUrl ?? null;
}

export interface UpsertSignalArgs {
  practiceId: string;
  kind: DetectorKind;
  evidenceId: string;
  confidence?: string | null;
  /** Required (U5): `signals.detected_at` is NOT NULL — provenance on every fact (R17). */
  detectedAt: Date;
  expiresAt?: Date | null;
  signalSource?: string | null;
}

/**
 * Idempotent signal upsert on (practice_id, kind, evidence_id). Always returns
 * the row: on a real conflict `returning()` is empty, so re-SELECT the existing
 * row by its unique key (mirrors `upsertPractice`).
 */
export async function upsertSignal(db: Database, args: UpsertSignalArgs) {
  const inserted = await db
    .insert(signals)
    .values({
      practiceId: args.practiceId,
      kind: args.kind,
      evidenceId: args.evidenceId,
      confidence: args.confidence ?? null,
      detectedAt: args.detectedAt,
      expiresAt: args.expiresAt ?? null,
      signalSource: args.signalSource ?? null,
    })
    .onConflictDoNothing({
      target: [signals.practiceId, signals.kind, signals.evidenceId],
    })
    .returning();
  if (inserted.length > 0) return inserted[0];

  const [existing] = await db
    .select()
    .from(signals)
    .where(
      and(
        eq(signals.practiceId, args.practiceId),
        eq(signals.kind, args.kind),
        eq(signals.evidenceId, args.evidenceId),
      ),
    )
    .limit(1);
  return existing;
}
