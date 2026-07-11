import { z } from "zod";
import { WorkspaceConfigSchema, type WorkspaceConfig } from "@/src/workspace/schema";

/**
 * The Adapt-It generation contracts (Phase 3).
 *
 * The onboarding produces a workspace config in two steps, so it needs two
 * sub-shapes of the ONE `WorkspaceConfigSchema` — never a parallel definition
 * that could drift from it:
 *   - `DraftWorkspaceConfigSchema`: everything EXCEPT `sampleFeed`, produced by
 *     `/api/adapt/generate` and edited by the user across the flow.
 *   - `SampleFeedSchema`: just the `sampleFeed` array, produced by
 *     `/api/adapt/finalize` and merged with the draft before `createWorkspace`.
 *
 * Both are derived from `WorkspaceConfigSchema` (`.omit` / `.shape`) so the day
 * that master schema changes, these follow automatically.
 */

export const DraftWorkspaceConfigSchema = WorkspaceConfigSchema.omit({
  sampleFeed: true,
});
export type DraftWorkspaceConfig = z.infer<typeof DraftWorkspaceConfigSchema>;

export const SampleFeedSchema = WorkspaceConfigSchema.shape.sampleFeed;
export type SampleFeed = z.infer<typeof SampleFeedSchema>;

/** What the user types on step 1; passed to `/api/adapt/generate`. */
export interface GenerateInput {
  companyName: string;
  whatYouSell: string;
  websiteUrl?: string | null;
}

// ─── Raw AI shapes ────────────────────────────────────────────────────────────
//
// What the model returns (structured outputs guarantees this SHAPE). These are
// deliberately loose — plain strings and numbers, no length or format caps —
// because size/format is enforced by mapping into `DraftWorkspaceConfigSchema` /
// `SampleFeedSchema` afterward. A raw-parse failure (empty stream, truncation)
// falls through to the deterministic template, so this never needs to be strict.

const rawSignalSchema = z.object({
  name: z.string(),
  kind: z.string(),
  why: z.string(),
  dataSource: z.string(),
  freshnessDays: z.number(),
});

const rawObjectionSchema = z.object({ q: z.string(), rebuttal: z.string() });

const rawProofSchema = z.object({
  claim: z.string(),
  /** "" when none inferable. */
  metric: z.string(),
  /** "" when none inferable. */
  sourceUrl: z.string(),
});

export const RawDraftSchema = z.object({
  business: z.object({
    oneLiner: z.string(),
    whatYouSell: z.string(),
    icp: z.string(),
    decisionMakerRoles: z.array(z.string()),
    geography: z.string(),
  }),
  signals: z.array(rawSignalSchema),
  pitch: z.object({
    painFit: z.string(),
    opener: z.object({
      leadWith: z.string(),
      vocabulary: z.array(z.string()),
      tone: z.string(),
      exampleOpener: z.string(),
    }),
    discoveryQuestions: z.array(z.string()),
    objections: z.array(rawObjectionSchema),
  }),
  proof: z.array(rawProofSchema),
  brand: z.object({
    productName: z.string(),
    primaryColor: z.string(),
    accentColor: z.string(),
    heroFrom: z.string(),
    heroTo: z.string(),
    logoText: z.string(),
  }),
});
export type RawDraft = z.infer<typeof RawDraftSchema>;

const rawSampleSignalSchema = z.object({ name: z.string(), kind: z.string() });

export const RawFeedSchema = z.object({
  prospects: z.array(
    z.object({
      name: z.string(),
      oneLine: z.string(),
      headline: z.string(),
      freshnessLabel: z.string(),
      signals: z.array(rawSampleSignalSchema),
      brief: z.object({
        whoToContact: z.object({
          name: z.string(),
          role: z.string(),
          channel: z.string(),
          personalization: z.string(),
        }),
        recommendedAction: z.string(),
        painFit: z.string(),
        proofLine: z.string(),
        discoveryQuestions: z.array(z.string()),
        objections: z.array(rawObjectionSchema),
      }),
    }),
  ),
});
export type RawFeed = z.infer<typeof RawFeedSchema>;

/**
 * Parse a model's text into JSON. Structured outputs return bare JSON, but a
 * truncated stream or a stray wrapper would break `JSON.parse`, so this also
 * salvages the first balanced object. Throws when nothing parses — the caller
 * treats a throw as "fall back to the deterministic template."
 */
export function parseModelJson(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1));
    }
    throw new Error("no JSON object found in model output");
  }
}

/** Re-export for callers that assemble the full config for `createWorkspace`. */
export type { WorkspaceConfig };
