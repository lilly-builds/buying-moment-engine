import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
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
 * with EXACT-match resolution only; fuzzy entity resolution, Clay enrichment, and
 * vertical classification are U5's job, not this rail's.
 */

export type IngestResult =
  | { status: "ingested"; practiceId: string; signalId: string }
  | { status: "duplicate" }
  | { status: "rejected"; reason: string };

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

function stableStringify(input: unknown): string {
  try {
    return JSON.stringify(input) ?? String(input);
  } catch {
    return String(input);
  }
}

function dedupeHashOf(input: unknown): string {
  const provided = readString(input, "dedupeHash");
  if (provided) return provided;
  return createHash("sha256").update(stableStringify(input)).digest("hex");
}

export async function ingestRawSignal(
  db: Database,
  input: unknown,
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
  const inserted = await db
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
  const practice = await upsertPractice(db, {
    name: data.practiceHint,
    geoKey: data.geoKey ?? "unknown",
  });
  const [ev] = await db
    .insert(evidence)
    .values({
      sourceUrl: data.sourceUrl,
      snippet: readString(data.payload, "snippet"),
      confidence: readNumericAsText(data.payload, "confidence"),
      detectedAt: data.detectedAt,
    })
    .returning({ id: evidence.id });
  const [sig] = await upsertSignal(db, {
    practiceId: practice.id,
    kind: data.detectorKind,
    evidenceId: ev.id,
    detectedAt: data.detectedAt,
    signalSource: data.detectorKind,
  });
  return { status: "ingested", practiceId: practice.id, signalId: sig.id };
}

export interface UpsertPracticeArgs {
  name: string;
  geoKey: string;
  city?: string | null;
  state?: string | null;
  vertical?: (typeof practices.$inferInsert)["vertical"];
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

export interface UpsertSignalArgs {
  practiceId: string;
  kind: DetectorKind;
  evidenceId: string;
  confidence?: string | null;
  detectedAt?: Date | null;
  expiresAt?: Date | null;
  signalSource?: string | null;
}

/** Idempotent signal upsert on (practice_id, kind, evidence_id). */
export async function upsertSignal(db: Database, args: UpsertSignalArgs) {
  return db
    .insert(signals)
    .values({
      practiceId: args.practiceId,
      kind: args.kind,
      evidenceId: args.evidenceId,
      confidence: args.confidence ?? null,
      detectedAt: args.detectedAt ?? null,
      expiresAt: args.expiresAt ?? null,
      signalSource: args.signalSource ?? null,
    })
    .onConflictDoNothing({
      target: [signals.practiceId, signals.kind, signals.evidenceId],
    })
    .returning({ id: signals.id });
}
