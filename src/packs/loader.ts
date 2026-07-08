import { packSchema, type VerticalPack } from "./schema";

/**
 * Pack loader (U7) — validates a pack's five variables (R6) at load time.
 * Pure: no I/O, no network. Citation URLs are checked for well-formedness
 * only (structural `z.url()` parsing) — actual link liveness is a manual
 * U15 click-test, not a loader concern.
 *
 * Mirrors the `validateRawSignal` shape in `src/ingest/validate.ts`: a
 * discriminated result, with a human-readable reason naming every missing or
 * malformed field so a bad pack fails loud instead of shipping silently.
 */

export type PackLoadResult =
  | { ok: true; pack: VerticalPack }
  | { ok: false; reason: string };

export function loadPack(input: unknown): PackLoadResult {
  const parsed = packSchema.safeParse(input);
  if (parsed.success) return { ok: true, pack: parsed.data };
  const reason = parsed.error.issues
    .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("; ");
  return { ok: false, reason };
}
