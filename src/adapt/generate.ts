import type { WorkspaceConfig } from "@/src/workspace/schema";
import type { AdaptClient } from "./client";
import { ADAPT_DRAFT_MAX_TOKENS } from "./config";
import { buildFallbackDraft } from "./fallback";
import {
  buildGeneratePrompt,
  GENERATE_JSON_SCHEMA,
  GENERATE_SYSTEM_PROMPT,
} from "./prompts";
import {
  DraftWorkspaceConfigSchema,
  parseModelJson,
  RawDraftSchema,
  type DraftWorkspaceConfig,
  type GenerateInput,
  type RawDraft,
} from "./schema";

/**
 * Step 1 of the Adapter: turn `{ companyName, whatYouSell, websiteUrl? }` into a
 * validated DRAFT workspace config (everything but the sample feed).
 *
 * The flow is: call Sonnet 5 (structured outputs) -> parse the raw JSON ->
 * normalize it into the real config shape -> validate against
 * `DraftWorkspaceConfigSchema`. ANY failure at ANY step falls through to a smart
 * deterministic template derived from the same inputs, so the endpoint can never
 * error out to the client. The caller learns which path ran via `source`.
 */

export interface GenerateResult {
  config: DraftWorkspaceConfig;
  source: "ai" | "fallback";
}

const HTTP_URL = /^https?:\/\//i;

/** True only for a syntactically valid http(s) URL — matches `z.url()`'s intent. */
function isHttpUrl(value: string): boolean {
  if (!HTTP_URL.test(value)) return false;
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

/** Clamp a freshness window into the schema's [1, 730] integer range. */
function clampFreshness(days: number): number {
  const n = Math.round(days);
  if (!Number.isFinite(n)) return 30;
  return Math.min(730, Math.max(1, n));
}

/**
 * Map the model's raw proof list into the workspace `proof` union. A proof point
 * with a real metric AND a valid public URL becomes a cited `{claim, metric,
 * sourceUrl}`; anything else with a claim becomes the honest `pending` sentinel;
 * an empty claim is dropped. The array may end up empty, which is valid.
 */
function mapProof(raw: RawDraft["proof"]): WorkspaceConfig["proof"] {
  const out: WorkspaceConfig["proof"] = [];
  for (const p of raw) {
    const claim = p.claim.trim();
    if (claim.length === 0) continue;
    const metric = p.metric.trim();
    const url = p.sourceUrl.trim();
    if (metric.length > 0 && isHttpUrl(url)) {
      out.push({ claim, metric, sourceUrl: url });
    } else {
      out.push({ claim, tag: "pending" });
    }
  }
  return out.slice(0, 20);
}

/**
 * Normalize a raw model draft into the real config shape. Light coercion only
 * (company name echoed from the trusted input, font forced to the one the app
 * ships, freshness clamped, proof union resolved). Everything else must arrive
 * valid from the model or the final `DraftWorkspaceConfigSchema.parse` rejects it
 * and the caller falls back wholesale.
 */
export function mapRawToDraft(
  raw: RawDraft,
  input: GenerateInput,
): DraftWorkspaceConfig {
  const mapped = {
    brand: {
      productName: raw.brand.productName,
      // The user typed this; never trust the model to echo it back correctly.
      // Clamp to the schema cap so a long name keeps the AI config instead of
      // needlessly forcing the whole thing to the fallback.
      companyName: input.companyName.trim().slice(0, 80),
      primaryColor: raw.brand.primaryColor.trim().toLowerCase(),
      accentColor: raw.brand.accentColor.trim().toLowerCase(),
      heroFrom: raw.brand.heroFrom.trim().toLowerCase(),
      heroTo: raw.brand.heroTo.trim().toLowerCase(),
      logoText: raw.brand.logoText.trim().length > 0 ? raw.brand.logoText : raw.brand.productName,
      // The app ships one font family; the model does not get to pick it.
      fontChoice: "inter",
    },
    business: {
      oneLiner: raw.business.oneLiner,
      whatYouSell: raw.business.whatYouSell,
      icp: raw.business.icp,
      decisionMakerRoles: raw.business.decisionMakerRoles.slice(0, 20),
      geography: raw.business.geography,
    },
    signals: raw.signals.slice(0, 3).map((s) => ({
      name: s.name,
      kind: s.kind,
      why: s.why,
      dataSource: s.dataSource,
      freshnessDays: clampFreshness(s.freshnessDays),
    })),
    pitch: {
      painFit: raw.pitch.painFit,
      opener: {
        leadWith: raw.pitch.opener.leadWith,
        vocabulary: raw.pitch.opener.vocabulary.slice(0, 20),
        tone: raw.pitch.opener.tone,
        exampleOpener: raw.pitch.opener.exampleOpener,
      },
      discoveryQuestions: raw.pitch.discoveryQuestions.slice(0, 10),
      objections: raw.pitch.objections.slice(0, 10),
    },
    proof: mapProof(raw.proof),
  };

  // Validates every length/format cap. Throws on any miss -> caller falls back.
  return DraftWorkspaceConfigSchema.parse(mapped);
}

export async function generateDraftConfig(
  input: GenerateInput,
  client: AdaptClient,
): Promise<GenerateResult> {
  try {
    const response = await client.complete({
      system: GENERATE_SYSTEM_PROMPT,
      prompt: buildGeneratePrompt(input),
      schema: GENERATE_JSON_SCHEMA,
      maxTokens: ADAPT_DRAFT_MAX_TOKENS,
    });
    const raw = RawDraftSchema.parse(parseModelJson(response.text));
    const config = mapRawToDraft(raw, input);
    return { config, source: "ai" };
  } catch {
    // Network error, timeout, empty/truncated stream, bad JSON, or a config that
    // failed validation -> the deterministic template. The flow never dead-ends.
    return { config: buildFallbackDraft(input), source: "fallback" };
  }
}
