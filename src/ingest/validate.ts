import { z } from "zod";

/**
 * Pure ingest validation (R17). No I/O — unit-testable without a database.
 * A malformed raw signal is rejected here BEFORE it can flow into normalized
 * tables; the caller records the rejection reason on the raw row.
 */

export const DETECTOR_KINDS = [
  "staffing_spike",
  "phone_complaints",
  "growth_events",
  "regulation",
] as const;

export type DetectorKind = (typeof DETECTOR_KINDS)[number];

export const rawSignalSchema = z.object({
  // Optional at the contract boundary — the ingest layer computes a fallback
  // hash when a source doesn't supply one, so every raw row stays de-dupable.
  dedupeHash: z.string().min(1).optional(),
  detectorKind: z.enum(DETECTOR_KINDS),
  payload: z.record(z.string(), z.unknown()),
  sourceUrl: z.url(),
  practiceHint: z.string().min(1),
  detectedAt: z.coerce.date(),
  geoKey: z.string().min(1).optional(),
});

export type RawSignalInput = z.input<typeof rawSignalSchema>;
export type ValidRawSignal = z.output<typeof rawSignalSchema>;

export type ValidationResult =
  | { ok: true; data: ValidRawSignal }
  | { ok: false; reason: string };

export function validateRawSignal(input: unknown): ValidationResult {
  const parsed = rawSignalSchema.safeParse(input);
  if (parsed.success) return { ok: true, data: parsed.data };
  const reason = parsed.error.issues
    .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("; ");
  return { ok: false, reason };
}

/** Deterministic name normalization for the practice de-dupe key. */
export function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}
