import { z } from "zod";
import type { ResearchFindings } from "./types";

/**
 * The citation gate (D2/R5). The model's JSON is parsed through this schema
 * BEFORE anything reaches the database. A "fact" without a well-formed
 * `sourceUrl` and a non-empty `snippet` fails to parse — so an uncited claim is
 * dropped at the boundary rather than trusted because the prompt asked nicely.
 *
 * Pure: no I/O. Mirrors the discriminated-result shape of `src/ingest/validate.ts`
 * and `src/packs/loader.ts` so a malformed body fails loud with the field named.
 */

const citedFactSchema = z.object({
  value: z.string().min(1),
  sourceUrl: z.url(),
  snippet: z.string().min(1),
});

const decisionMakerSchema = z.object({
  // null = D9's role-only variant. A missing NAME is honest; a missing ROLE means
  // we learned nothing about who to contact, so the whole object must be null.
  name: citedFactSchema.nullable(),
  role: citedFactSchema,
  email: citedFactSchema.nullable().default(null),
  linkedinUrl: citedFactSchema.nullable().default(null),
});

/**
 * STRICT: an unknown firmographics key is a parse failure, not a silent pass. The
 * old `z.record()` accepted anything the model invented — including the derived
 * tallies KTD-4 removed, which cannot be honestly cited.
 */
const firmographicsSchema = z
  .strictObject({
    specialty: citedFactSchema.optional(),
    website: citedFactSchema.optional(),
    yearFounded: citedFactSchema.optional(),
  })
  .default({});

export const researchFindingsSchema = z.object({
  firmographics: firmographicsSchema,
  ehr: citedFactSchema.nullable().default(null),
  incumbentTooling: z.array(citedFactSchema).default([]),
  decisionMaker: decisionMakerSchema.nullable().default(null),
  buyingMomentContext: z.array(citedFactSchema).default([]),
});

export type ParseResult =
  | { ok: true; findings: ResearchFindings }
  | { ok: false; reason: string };

/**
 * Pull the first balanced top-level JSON object out of the model's text.
 *
 * THIS NOW SERVES ONLY THE AGENTIC ESCALATION PATH (`research.ts`). The primary
 * path — `extract.ts` — holds the page text itself, declares no `web_fetch`, and
 * therefore may use `output_config.format` (structured outputs), which returns
 * bare JSON and needs no scanner.
 *
 * It cannot be deleted, as the mechanism plan's KTD-5 proposed. The escalation
 * client still declares `web_fetch` with `citations: {enabled: true}`, and
 * structured outputs are documented as incompatible with citations (400). So that
 * path still answers in prose-wrapped JSON and still needs extracting-then-
 * validating — the schema, not the model, decides what counts as a fact.
 *
 * When a `{` opens but never closes (a truncated or corrupt body) we return the
 * unbalanced remainder rather than null, so `JSON.parse` reports the real syntax
 * error. Returning null there would report "no JSON object found" for a response
 * that plainly contains one — a misleading reason is a debugging tax later.
 */
export function extractJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return text.slice(start);
}

/** Parse + validate the model's research output. Never throws. */
export function parseResearchOutput(text: string): ParseResult {
  const json = extractJsonObject(text);
  if (!json) return { ok: false, reason: "no JSON object found in response" };

  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: `malformed JSON: ${message}` };
  }

  const parsed = researchFindingsSchema.safeParse(raw);
  if (parsed.success) return { ok: true, findings: parsed.data };

  const reason = parsed.error.issues
    .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("; ");
  return { ok: false, reason };
}

/** True when research produced nothing usable — no facts, no contact, no moment. */
export function isEmptyFindings(findings: ResearchFindings): boolean {
  return (
    // `Object.values` on the fixed shape: an absent optional field is `undefined`.
    Object.values(findings.firmographics).every((fact) => fact === undefined) &&
    findings.ehr === null &&
    findings.incumbentTooling.length === 0 &&
    findings.decisionMaker === null &&
    findings.buyingMomentContext.length === 0
  );
}
