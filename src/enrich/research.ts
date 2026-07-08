import type { Meter } from "@/src/roi/cost-meter";
import {
  anthropicCallCostUsd,
  anthropicCostBreakdown,
  PIPELINE_STEP_RESEARCH,
} from "./config";
import { parseResearchOutput } from "./research-schema";
import type {
  ClaudeUsage,
  ResearchClient,
  ResearchFindings,
  ResearchRequest,
} from "./types";

/**
 * Stage 1 of the waterfall (spec § Stack): Claude agentic web research. It reads
 * the practice's real site/staff page for firmographics, EHR / incumbent tooling,
 * the decision-maker's name + role, and the buying-moment context PDL has no data
 * for — citing every fact to its source (D2).
 *
 * R19: the Anthropic call is wrapped in `meter`, which writes ONE `cost_events`
 * row per HTTP request. `units = 1` request; `unitCostUsd` is resolved from the
 * response's own `usage` block (tokens + the server-side web-search charge that
 * rides inside the same call), with the component split carried in `meta`.
 *
 * PARSING HAPPENS OUTSIDE THE METER, on purpose. A malformed JSON body still cost
 * real money — Anthropic billed the request. Parsing inside `fn` would turn that
 * into a throw, the meter would record nothing, and measured CAC would understate
 * spend exactly on the calls that went wrong.
 */

export interface ResearchDeps {
  client: ResearchClient;
  meter: Meter;
  practiceId?: string | null;
}

export type ResearchOutcome =
  | { ok: true; findings: ResearchFindings; usage: ClaudeUsage; model: string }
  | { ok: false; reason: string; usage: ClaudeUsage; model: string };

export async function runResearch(
  deps: ResearchDeps,
  request: ResearchRequest,
): Promise<ResearchOutcome> {
  const response = await deps.meter(
    {
      provider: "anthropic",
      operation: "messages.create",
      pipelineStep: PIPELINE_STEP_RESEARCH,
      practiceId: deps.practiceId ?? null,
      // One metered paid call = one HTTP request to /v1/messages.
      units: 1,
      unitCostUsd: (res) => anthropicCallCostUsd(res.usage),
      meta: (res) => ({
        ...anthropicCostBreakdown(res.usage),
        practiceName: request.practiceName,
      }),
    },
    () => deps.client.research(request),
  );

  const parsed = parseResearchOutput(response.text);
  if (!parsed.ok) {
    return {
      ok: false,
      reason: parsed.reason,
      usage: response.usage,
      model: response.model,
    };
  }
  return {
    ok: true,
    findings: parsed.findings,
    usage: response.usage,
    model: response.model,
  };
}
