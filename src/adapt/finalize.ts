import { getDb } from "@/db/client";
import type { Database } from "@/db/types";
import { setActiveWorkspace } from "@/src/workspace/active";
import { createWorkspace } from "@/src/workspace/store";
import type { WorkspaceConfig } from "@/src/workspace/schema";
import type { AdaptClient } from "./client";
import { ADAPT_FEED_MAX_TOKENS } from "./config";
import { buildFallbackSampleFeed, slugify } from "./fallback";
import { buildFeedPrompt, FEED_JSON_SCHEMA, FEED_SYSTEM_PROMPT } from "./prompts";
import {
  parseModelJson,
  RawFeedSchema,
  SampleFeedSchema,
  type DraftWorkspaceConfig,
  type RawFeed,
  type SampleFeed,
} from "./schema";

/**
 * Step 2 of the Adapter: generate the sample feed for a confirmed draft config,
 * then persist the full workspace and make it active.
 *
 * Same never-dead-end contract as `generate.ts`: the Claude call for the feed
 * has a deterministic fallback, so `generateSampleFeed` always returns a valid,
 * exactly-three-item feed. Persistence (DB) and cookie writes are the only things
 * that can fail the route, and those are honest infrastructure errors, not the
 * model's.
 */

/**
 * Normalize the model's raw prospects into the `sampleFeed` shape. Assigns stable
 * ids in code (the model never sees them), pads a prospect that returned no
 * signals with the config's strongest one, and caps counts. The final
 * `SampleFeedSchema.parse` enforces every length/format rule; a miss throws and
 * the caller falls back.
 */
export function mapRawToSampleFeed(
  raw: RawFeed,
  config: DraftWorkspaceConfig,
): SampleFeed {
  const primarySignal = config.signals[0];
  const mapped = raw.prospects.slice(0, 3).map((p, i) => {
    const signals =
      p.signals.length > 0
        ? p.signals.slice(0, 10)
        : [{ name: primarySignal.name, kind: primarySignal.kind }];
    return {
      id: `sample-${i + 1}`,
      name: p.name,
      oneLine: p.oneLine,
      headline: p.headline,
      freshnessLabel: p.freshnessLabel,
      signals,
      brief: {
        whoToContact: p.brief.whoToContact,
        recommendedAction: p.brief.recommendedAction,
        painFit: p.brief.painFit,
        proofLine: p.brief.proofLine,
        discoveryQuestions: p.brief.discoveryQuestions.slice(0, 10),
        objections: p.brief.objections.slice(0, 10),
      },
    };
  });
  return SampleFeedSchema.parse(mapped);
}

export async function generateSampleFeed(
  config: DraftWorkspaceConfig,
  client: AdaptClient,
): Promise<SampleFeed> {
  try {
    const response = await client.complete({
      system: FEED_SYSTEM_PROMPT,
      prompt: buildFeedPrompt(config),
      schema: FEED_JSON_SCHEMA,
      maxTokens: ADAPT_FEED_MAX_TOKENS,
    });
    const raw = RawFeedSchema.parse(parseModelJson(response.text));
    const feed = mapRawToSampleFeed(raw, config);
    // The contract is EXACTLY three prospects (the schema has no minimum, so a
    // short feed would otherwise slip through). Anything else is a miss ->
    // deterministic fallback, which always returns three.
    if (feed.length !== 3) throw new Error("sample feed must have exactly 3 prospects");
    return feed;
  } catch {
    return buildFallbackSampleFeed(config);
  }
}

export interface FinalizeDeps {
  client: AdaptClient;
  /** Injected in tests; defaults to the real singleton in the route. */
  db?: Database;
  /** Injected in tests; defaults to the cookie writer in the route. */
  setActive?: (slug: string) => Promise<void>;
}

export interface FinalizeResult {
  slug: string;
}

/**
 * Generate the sample feed, assemble the full workspace config, persist it, and
 * set it active. `createWorkspace` validates the WHOLE config against
 * `WorkspaceConfigSchema` before any write, so a malformed assembly fails loud
 * rather than shipping a broken tenant. Returns the (possibly de-duplicated)
 * slug the workspace was actually stored under.
 */
export async function finalizeWorkspace(
  draft: DraftWorkspaceConfig,
  deps: FinalizeDeps,
): Promise<FinalizeResult> {
  const sampleFeed = await generateSampleFeed(draft, deps.client);
  const config: WorkspaceConfig = { ...draft, sampleFeed };

  const name = draft.brand.companyName;
  const slug = slugify(draft.brand.companyName || draft.brand.productName);

  const workspace = await createWorkspace(
    { name, slug, config },
    deps.db ?? getDb(),
  );

  const setActive = deps.setActive ?? setActiveWorkspace;
  await setActive(workspace.slug);

  return { slug: workspace.slug };
}
