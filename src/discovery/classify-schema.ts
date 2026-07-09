import { z } from "zod";

/**
 * The qualifier's output gate (U3). The model's JSON is parsed through this schema
 * BEFORE its verdict is trusted. The API guarantees SHAPE (structured outputs);
 * only zod, and then the pipeline's confidence floor, speak to whether the verdict
 * is usable. Pure, and it NEVER throws — every body handed to it came back on a 200
 * that Anthropic already billed, so a throw here would unwind past the cost meter
 * and record nothing (the failure `src/roi/cost-meter.ts` forbids). Mirrors the
 * discriminated-result shape of `src/enrich/research-schema.ts`.
 */

const classifyOutputSchema = z.object({
  qualifies: z.boolean(),
  // Advisory. Zod enforces it is a number in range; it does not (cannot) enforce
  // that the model's self-estimate is CALIBRATED — the tenant confidence floor and
  // the precision-guarded prompt do that work.
  confidence: z.number().min(0).max(1),
  // A short closed-vocabulary label ("cannot-get-through", "long-hold", "none"),
  // never the review's own words (R5, enforced by the prompt's rule 8).
  category: z.string().min(1),
});

export type ClassifyOutput = z.infer<typeof classifyOutputSchema>;

export type ClassifyParseResult =
  | { ok: true; result: ClassifyOutput }
  | { ok: false; reason: string };

/**
 * Parse + validate the qualifier's output. Structured outputs return bare JSON, so
 * there is no prose wrapper to scan — a direct `JSON.parse`, guarded. A billed-200
 * whose body is truncated/malformed (or the empty string of an unpriced envelope)
 * becomes a recorded `{ ok:false }`, never a throw.
 */
export function parseClassifyOutput(text: string): ClassifyParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: `malformed JSON: ${message}` };
  }

  const parsed = classifyOutputSchema.safeParse(raw);
  if (parsed.success) return { ok: true, result: parsed.data };

  const reason = parsed.error.issues
    .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("; ");
  return { ok: false, reason };
}
