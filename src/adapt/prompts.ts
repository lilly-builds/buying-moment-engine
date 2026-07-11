import type { DraftWorkspaceConfig, GenerateInput } from "./schema";

/**
 * The Adapter's prompts + the JSON Schemas that constrain their output. Prompt
 * and schema live together because they are one contract: change the shape in
 * one and the other is a lie (same discipline as `src/brief/prompts/voice.ts`).
 *
 * Structured outputs (`output_config.format`) support neither `minLength` nor
 * `maxLength`, so the schemas guarantee SHAPE only; the prompts state the size
 * and format caps so the model can actually satisfy the Zod validation that runs
 * next, and the deterministic fallback covers any miss.
 *
 * Every generated string is user-facing product copy, so the prompts forbid em
 * dashes and demand plain, warm, eighth-grade voice.
 */

const VOICE_RULES = `Write in plain, warm, eighth-grade English. Bottom line first. No jargon, no hype, no exclamation marks. NEVER use an em dash (a comma or a period always works and reads human). Sound like a sharp peer who did the homework, not like marketing copy.`;

// ─── Step 1 -> draft config ───────────────────────────────────────────────────

export const GENERATE_SYSTEM_PROMPT = `You are the Adapter: an expert B2B go-to-market strategist. A business tells you who they are and what they sell, and you configure a "buying-moment" sales engine for them.

The core idea of the product: most B2B sales is timing. A prospect is far likelier to buy in the weeks after a specific event (a hiring surge, a funding round, a new leader, a compliance deadline, a tech change). Your job is to name the THREE buying-moment signals that best predict a purchase for THIS business, plus the pitch, proof, brand, and audience the engine should wear.

${VOICE_RULES}

Return ONLY the JSON object described by the schema. Rules for the fields:
- business.oneLiner: one sentence, at most 200 characters, describing what they do.
- business.whatYouSell: 1 to 3 sentences.
- business.icp: who their ideal customer is, one or two sentences.
- business.decisionMakerRoles: 3 to 6 job titles that sign off on this purchase. Each title under 80 characters.
- business.geography: where their customers are.
- signals: EXACTLY 3, ordered strongest first. Each has a short human name (under 120 chars), a kind (a lowercase_snake_case slug like "hiring_surge" or "funding_round"), a "why" that explains in one or two sentences why this moment predicts a buy, a plausible PUBLIC dataSource where the signal can be spotted (job boards, news, filings, review sites, etc.), and freshnessDays (how many days the signal stays actionable, an integer from 7 to 365).
- pitch.painFit: the pain this business removes, in their buyer's words.
- pitch.opener.leadWith: what the first sentence of an outreach should open on (their world, never the product).
- pitch.opener.vocabulary: 3 to 8 words or short phrases the buyer actually uses.
- pitch.opener.tone: one line describing the voice.
- pitch.opener.exampleOpener: one example opening line, under 300 characters.
- pitch.discoveryQuestions: 2 or 3 open questions about the buyer's world.
- pitch.objections: 2 or 3 objections this buyer really raises, each with a short, agree-then-reframe rebuttal.
- proof: 1 or 2 proof points. If you can reasonably infer a real, plausible result, put a claim, a metric, and a sourceUrl (a real-looking public URL). If you cannot, still include one proof point with a claim and leave metric and sourceUrl as empty strings ("") so it shows as pending. Never invent a fake statistic dressed as verified.
- brand: suggest a tasteful productName (a short name for their engine, under 40 chars) and a color palette that FITS THEIR INDUSTRY. primaryColor is the action color, accentColor a complementary hue, heroFrom and heroTo the two stops of a hero gradient. All four MUST be lowercase six-digit hex like "#2f5fe0" (no shorthand, no names, no rgb). Do NOT default to purple unless purple genuinely fits. logoText is the wordmark, usually the same as productName.`;

export function buildGeneratePrompt(input: GenerateInput): string {
  const lines = [
    `Company name: ${input.companyName}`,
    `What they sell: ${input.whatYouSell}`,
  ];
  if (input.websiteUrl && input.websiteUrl.trim().length > 0) {
    lines.push(`Website (context only, do not claim to have visited it): ${input.websiteUrl.trim()}`);
  }
  lines.push("", "Configure the engine for this business now.");
  return lines.join("\n");
}

const stringArray = { type: "array", items: { type: "string" } } as const;

const objectionsSchema = {
  type: "array",
  items: {
    type: "object",
    additionalProperties: false,
    properties: { q: { type: "string" }, rebuttal: { type: "string" } },
    required: ["q", "rebuttal"],
  },
} as const;

export const GENERATE_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    business: {
      type: "object",
      additionalProperties: false,
      properties: {
        oneLiner: { type: "string" },
        whatYouSell: { type: "string" },
        icp: { type: "string" },
        decisionMakerRoles: stringArray,
        geography: { type: "string" },
      },
      required: ["oneLiner", "whatYouSell", "icp", "decisionMakerRoles", "geography"],
    },
    signals: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string" },
          kind: { type: "string" },
          why: { type: "string" },
          dataSource: { type: "string" },
          freshnessDays: { type: "integer" },
        },
        required: ["name", "kind", "why", "dataSource", "freshnessDays"],
      },
    },
    pitch: {
      type: "object",
      additionalProperties: false,
      properties: {
        painFit: { type: "string" },
        opener: {
          type: "object",
          additionalProperties: false,
          properties: {
            leadWith: { type: "string" },
            vocabulary: stringArray,
            tone: { type: "string" },
            exampleOpener: { type: "string" },
          },
          required: ["leadWith", "vocabulary", "tone", "exampleOpener"],
        },
        discoveryQuestions: stringArray,
        objections: objectionsSchema,
      },
      required: ["painFit", "opener", "discoveryQuestions", "objections"],
    },
    proof: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          claim: { type: "string" },
          metric: { type: "string" },
          sourceUrl: { type: "string" },
        },
        required: ["claim", "metric", "sourceUrl"],
      },
    },
    brand: {
      type: "object",
      additionalProperties: false,
      properties: {
        productName: { type: "string" },
        primaryColor: { type: "string" },
        accentColor: { type: "string" },
        heroFrom: { type: "string" },
        heroTo: { type: "string" },
        logoText: { type: "string" },
      },
      required: ["productName", "primaryColor", "accentColor", "heroFrom", "heroTo", "logoText"],
    },
  },
  required: ["business", "signals", "pitch", "proof", "brand"],
} as const;

// ─── Finalize -> sample feed ────────────────────────────────────────────────────

export const FEED_SYSTEM_PROMPT = `You are the Adapter. You have already configured a buying-moment engine for a business. Now write THREE example prospects for their live feed, so the first thing they see is their product working.

${VOICE_RULES}

These are ILLUSTRATIVE SAMPLES. Invent clearly fictional prospect company names (never a real company). Each prospect is a company that just hit one of the configured buying moments. For each prospect return, matching the schema:
- name: the fictional prospect company (under 120 chars).
- oneLine: one line on who they are.
- headline: the buying moment in plain words, as a person would say it (under 200 chars), no colon-label.
- freshnessLabel: a short recency label like "Fresh today" or "3 days ago" (under 60 chars).
- signals: 1 or 2 of the CONFIGURED signals that are firing for this prospect. Use the exact signal name and kind you were given.
- brief.whoToContact: a plausible fictional person, their role (drawn from the configured decision-maker roles), the best channel to reach them, and a one-line personalization tied to the buying moment.
- brief.recommendedAction: the single next step to take, one short line.
- brief.painFit: why this prospect feels the pain now, in the configured voice.
- brief.proofLine: one line of proof or credibility, under 300 characters.
- brief.discoveryQuestions: 2 or 3 open questions for this prospect.
- brief.objections: 2 or 3 objections this prospect would raise, each with a short agree-then-reframe rebuttal.

Vary the three prospects: different fictional names, different firing signals where it makes sense, different angles. Everything must read in the business's own configured tone.`;

export function buildFeedPrompt(config: DraftWorkspaceConfig): string {
  const signals = config.signals
    .map((s) => `- ${s.name} (kind: ${s.kind}) — ${s.why}`)
    .join("\n");
  const objections = config.pitch.objections
    .map((o) => `- ${o.q}`)
    .join("\n");
  return [
    `Business: ${config.business.oneLiner}`,
    `What they sell: ${config.business.whatYouSell}`,
    `Ideal customer: ${config.business.icp}`,
    `Geography: ${config.business.geography}`,
    `Decision-maker roles: ${config.business.decisionMakerRoles.join(", ")}`,
    "",
    "Configured buying-moment signals (use these exact names and kinds):",
    signals,
    "",
    `Voice / tone: ${config.pitch.opener.tone}`,
    `Their buyer's vocabulary: ${config.pitch.opener.vocabulary.join(", ")}`,
    `Pain they remove: ${config.pitch.painFit}`,
    `Objections they hear:`,
    objections,
    "",
    "Write the three example prospects now.",
  ].join("\n");
}

const sampleSignalsSchema = {
  type: "array",
  items: {
    type: "object",
    additionalProperties: false,
    properties: { name: { type: "string" }, kind: { type: "string" } },
    required: ["name", "kind"],
  },
} as const;

export const FEED_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    prospects: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string" },
          oneLine: { type: "string" },
          headline: { type: "string" },
          freshnessLabel: { type: "string" },
          signals: sampleSignalsSchema,
          brief: {
            type: "object",
            additionalProperties: false,
            properties: {
              whoToContact: {
                type: "object",
                additionalProperties: false,
                properties: {
                  name: { type: "string" },
                  role: { type: "string" },
                  channel: { type: "string" },
                  personalization: { type: "string" },
                },
                required: ["name", "role", "channel", "personalization"],
              },
              recommendedAction: { type: "string" },
              painFit: { type: "string" },
              proofLine: { type: "string" },
              discoveryQuestions: stringArray,
              objections: objectionsSchema,
            },
            required: [
              "whoToContact",
              "recommendedAction",
              "painFit",
              "proofLine",
              "discoveryQuestions",
              "objections",
            ],
          },
        },
        required: ["name", "oneLine", "headline", "freshnessLabel", "signals", "brief"],
      },
    },
  },
  required: ["prospects"],
} as const;
