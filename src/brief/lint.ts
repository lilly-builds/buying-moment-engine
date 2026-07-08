import { voiceProseFields, type VoiceBrief } from "./schema";

/**
 * The second gate on model-authored prose (U6).
 *
 * `schema.ts` proves a voice field is ATTRIBUTED — it names an evidence id we
 * supplied. It cannot prove the sentence is TRUE. This file closes the one gap that
 * actually reaches an AE's mouth on a call: **a number the evidence never contained.**
 * "Your twelve locations." "You'll cut no-shows 40%." Both are schema-valid, both are
 * fabrications, and both are the kind of thing a prospect corrects you on.
 *
 * It also enforces the four writing directives (Lilly, 2026-07-08) — friendly, concise,
 * skimmable, and grounded in real selling rather than AI house style. Three of those
 * four are mechanical, so they are TESTS. Friendliness is not mechanical; it lives in
 * `prompts/voice.ts` and is checked by a human at U15. Saying so is more honest than
 * pretending a regex measures warmth.
 *
 * Pure: no I/O, no clock. A violation is a RESULT, not a throw — `synthesize.ts` feeds
 * the violations back into exactly one retry, and a second failure kills the brief.
 * A brief that states an unprovable number must not ship; that is the same line D2
 * draws, applied to prose instead of facts.
 */

export type ViolationKind =
  /** A digit the grounding corpus does not contain. The fabrication guard. */
  | "ungrounded-number"
  /** Cold-email boilerplate and LLM house style. See `AI_TELLS`. */
  | "ai-tell"
  /** A sentence long enough that an AE skimming it will lose the thread. */
  | "long-sentence"
  /** Em-dash pile-up — the single most recognizable tell in current AI prose. */
  | "em-dash-overuse"
  /** A fuzzy count ("a couple of patients") overclaiming from thin evidence. */
  | "vague-quantifier";

export interface Violation {
  kind: ViolationKind;
  /** Dotted path from `voiceProseFields`, e.g. `sequence.touches[1].body`. */
  field: string;
  /** What to change, phrased so it can be handed straight back to the model. */
  detail: string;
}

export interface LintResult {
  ok: boolean;
  violations: Violation[];
}

/**
 * Longest sentence an AE can absorb at a glance. Plain-language guidance puts
 * comfortable reading around 20-25 words; 32 is a ceiling, not a target, so the lint
 * catches runaway clauses without policing rhythm.
 */
export const MAX_SENTENCE_WORDS = 32;

/**
 * Em dashes per field. Two is generous prose; three in one paragraph reads as machine
 * writing to anyone who has skimmed a generated email this year. The cap is on the
 * FIELD, not the whole brief, so a long touch body and a short subject are judged the
 * same way.
 */
export const MAX_EM_DASHES_PER_FIELD = 2;

/**
 * Phrases that mark copy as machine-written or as generic cold-email filler.
 *
 * Every entry earns its place by being (a) a genuine tell and (b) unnecessary — there
 * is always a better, more concrete sentence. The constraint improves the writing: a
 * model forbidden from "24/7" writes "around the clock"; forbidden from "leverage" it
 * writes "use". That is the point.
 *
 * Matched case-insensitively against whitespace-collapsed text, as SUBSTRINGS. So
 * entries must be specific enough not to swallow legitimate prose: we ban
 * "streamline your", not "streamline"; "unlock your", not "unlock"; "wanted to reach
 * out", not "reach out".
 */
export const AI_TELLS: readonly string[] = [
  // Cold-email openers that say nothing. Entries are the SHORTEST distinctive form:
  // "wanted to reach out" already covers "I wanted to" and "just wanted to", and a
  // test pins that no entry is a substring of another — two entries firing on one
  // phrase would report the same defect twice and dilute the retry instructions.
  "hope this email finds you well",
  "hope this finds you well",
  "hope you're doing well",
  "hope all is well",
  "wanted to reach out",
  "i came across",
  "i stumbled upon",
  "i noticed that you",
  "per my last email",
  "following up on my previous",
  "circling back",
  "circle back",
  "touch base",
  "pick your brain",
  // LLM house style.
  "delve",
  "tapestry",
  "it's worth noting",
  "it is worth noting",
  "furthermore",
  "moreover",
  "in conclusion",
  "at the end of the day",
  "navigate the complexities",
  "navigating the complexities",
  "in today's fast-paced",
  "in today's ever-evolving",
  "ever-evolving landscape",
  "as an ai",
  "as a language model",
  // Vendor filler. A clinic manager has read all of these a hundred times.
  "leverage",
  "seamless",
  "cutting-edge",
  "state-of-the-art",
  "best-in-class",
  "game-changer",
  "game changer",
  "revolutionize",
  "revolutionary",
  "transformative",
  "supercharge",
  "empower",
  "synergy",
  "synergies",
  "value proposition",
  "low-hanging fruit",
  "robust solution",
  "solution provider",
  // NOT banned: "holistic". It is a genuine word in healthcare positioning, and a
  // personalization snippet quoting a practice's own "holistic skin care" line would be
  // rejected, retried, and then killed. A tell that fires on a true sentence costs more
  // than the tell it catches.
  "look no further",
  "streamline your",
  "unlock your",
  "unlock the power",
  "elevate your",
];

const WHITESPACE_RUN = /\s+/g;
/** Thousands separators, so `2,000` and `2000` are the same number on both sides. */
const DIGIT_GROUPING = /(?<=\d),(?=\d)/g;
/**
 * A maximal number token, extracted AFTER `normalizeForGrounding` has already removed
 * digit-grouping commas — so `2,000` is `2000` by the time this runs and the class needs no
 * comma of its own. It must not carry one: including `,` in the class made the token greedily
 * swallow a TRAILING comma, and the first live call wrote "serving Omaha since 2004, and…" —
 * `"2004,"` then failed to match the grounded `"2004"`, a false ungrounded-number on a true
 * fact. Digits and an optional decimal only.
 */
const NUMBER_TOKEN = /\d+(?:\.\d+)?/g;
/** Sentence terminator followed by whitespace, or end of string. */
const SENTENCE_SPLIT = /(?<=[.!?])\s+/;
const EM_DASH = /—/g;

/**
 * The length of the meeting WE are proposing — "a 15-minute call" — is not a claim about
 * the practice, so it needs no evidence. It is the only unevidenced number the brief may
 * contain, and the exemption is scoped as narrowly as English allows.
 *
 * Three conditions, and every one of them is load-bearing:
 *   1. a length we would actually PROPOSE — 10/15/20/25/30/45/60 minutes, an allowlist. An
 *      arbitrary number that merely precedes a meeting noun is not our ask: "a 12 minute
 *      call" is a fabricated duration about the prospect, and it is now caught (P2-6).
 *   2. a **singular** minutes-unit (`minute` / `min`, never `minutes` / `mins`),
 *   3. a short-session noun immediately after it.
 *
 * Condition 2 is not pedantry, it is a guard. A duration ADJECTIVE is singular — "a
 * 15-minute call" — while a claim about the practice's own time is plural: "we save 30
 * minutes call handling time daily". Allowing the plural form laundered that fabricated
 * statistic straight through the truth gate.
 *
 * Word-forms reach here already folded to digits (`wordNumbersToDigits` runs first), so the
 * live CTA "a fifteen-minute look" arrives as "a 15-minute look" — which is why "look" and
 * "review" are in the noun list (P2-7). Neither `45%` (no unit), `45 minutes of hold time`
 * (plural + no session noun), nor "a 30-minute savings" (not a session noun) is exempted.
 */
const MEETING_DURATION =
  /\b(?:10|15|20|25|30|45|60)\s?-?\s?(?:minute|min)\s+(?:call|chat|conversation|meeting|demo|intro|introduction|walkthrough|look|review|overview|window)\b/gi;

/**
 * "Mind if I take thirty seconds?" — the length of our ASK, governed by an ask verb, not a
 * claim about the practice. The verb is the whole distinction: "take 30 seconds" is our ask,
 * "we save 30 seconds a call" is a statistic, and "save" / "lose" / "waste" are not ask verbs.
 * Word-forms arrive folded to digits, so "take thirty seconds" is "take 30 seconds" here.
 */
const OUR_ASK_DURATION =
  /\b(?:take|give|spare|grab|steal|need)\s+(?:me\s+|you\s+|us\s+)?(?:5|10|15|20|30|45|60|90)\s?-?\s?(?:second|sec|minute|min)s?\b/gi;

/**
 * Both sides of the number comparison get this, identically. Any transform applied to
 * the prose and not the corpus (or the reverse) invents a violation or hides one —
 * the same rule `citations.ts` states for its own normalization, for the same reason.
 */
export function normalizeForGrounding(text: string): string {
  return text
    .toLowerCase()
    .replace(DIGIT_GROUPING, "")
    .replace(WHITESPACE_RUN, " ")
    .trim();
}

// ─── word-numbers → digits, so a spelled-out statistic cannot slip past the digit gate ──
//
// The digit-only guard had a documented hole — "false precision travels as digits" — and the
// first live call walked straight through it: constrained by the number ban, the model wrote
// "thirty seconds" and "fifteen-minute" as WORDS, and nothing would have stopped "forty
// percent" (P2-7). So number-words are folded to digits before extraction — on BOTH the prose
// and the corpus, since this runs inside `numberTokens`, keeping the two sides identical.
//
// `one` is left alone on purpose: it is overwhelmingly a pronoun ("one thing", "one reply
// away"), not a count. Ordinals ("second", "third") are cardinals' look-alikes and are left
// alone too — only cardinal words map. Word boundaries keep "often"/"Twentynine" intact.
const TENS: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};
const UNITS: Record<string, number> = {
  two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19,
};
const SCALES: Record<string, number> = { hundred: 100, thousand: 1000, million: 1_000_000 };
/** "one" IS allowed as the ones part of a compound ("twenty-one"); only standalone "one" is a pronoun. */
const COMPOUND_UNITS: Record<string, number> = { one: 1, ...UNITS };

const COMPOUND_WORD =
  /\b(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)[\s-](one|two|three|four|five|six|seven|eight|nine)\b/gi;
const TENS_WORD = /\b(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)\b/gi;
const UNIT_WORD =
  /\b(two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen)\b/gi;
const SCALED_NUMBER = /\b(\d+)[\s-]+(hundred|thousand|million)\b/gi;
const BARE_SCALE = /\b(hundred|thousand|million)\b/gi;
const PERCENT_WORD = /\bpercent\b/gi;

export function wordNumbersToDigits(text: string): string {
  return text
    .replace(COMPOUND_WORD, (_m, tens: string, unit: string) =>
      String(TENS[tens.toLowerCase()] + COMPOUND_UNITS[unit.toLowerCase()]),
    )
    .replace(TENS_WORD, (_m, tens: string) => String(TENS[tens.toLowerCase()]))
    .replace(UNIT_WORD, (_m, unit: string) => String(UNITS[unit.toLowerCase()]))
    .replace(SCALED_NUMBER, (_m, n: string, scale: string) => String(Number(n) * SCALES[scale.toLowerCase()]))
    .replace(BARE_SCALE, (_m, scale: string) => String(SCALES[scale.toLowerCase()]))
    .replace(PERCENT_WORD, "%");
}

/** Every maximal number token in `text`, with word-numbers folded in first. */
export function numberTokens(text: string): string[] {
  return normalizeForGrounding(wordNumbersToDigits(text)).match(NUMBER_TOKEN) ?? [];
}

/**
 * The strings a grounding corpus is built from, in TWO buckets — because not every number
 * the model was shown may be asserted about the practice.
 *
 *  - `evidence`: the practice's own identity and cited facts, and the snippets of the
 *    signals it was shown. A number here is a fact ABOUT this practice; it may appear
 *    anywhere in the brief.
 *  - `pack`: the vertical pack's OWN cited figures — a case study's metrics, the ROI
 *    benchmarks. They are real, but they belong to someone else (Texas Dermatology's
 *    2,000 calls are not the prospect's), so the brief may state them ONLY where the
 *    prompt permits the proof point: inside a rebuttal.
 *
 * Folding both into one set is what let a touch body say "you are fielding roughly 2,000
 * calls a month and losing 250 new patients" — the pack's numbers, asserted about the
 * prospect, citing nothing — and pass every gate (P1-3).
 */
export interface GroundingParts {
  evidence: readonly (string | null | undefined)[];
  pack: readonly (string | null | undefined)[];
}

/**
 * The numbers the brief is allowed to state, as SETS of maximal tokens.
 *
 * Sets, not a substring search over the raw text. The substring version has two silent
 * failure modes and this has neither:
 *   - `"2,000 calls".includes("200")` is TRUE, so a model could halve a practice's call
 *     volume and pass.
 *   - a digit-boundary regex reads `13.4` as containing the number `13`, because `.` is
 *     not a digit — so `13` would ground against a decimal it is only the head of.
 * Membership in the maximal-token set answers "did anyone actually write this number?",
 * which is the only question worth asking.
 *
 * `evidence` is built from the SAME inputs the model was shown. Wider than the model's
 * input and a fabrication passes; narrower and a true fact is rejected. `pack` is the
 * separately-guarded proof-point set — see `GroundingParts`.
 */
export interface GroundingCorpus {
  evidence: ReadonlySet<string>;
  pack: ReadonlySet<string>;
}

export function buildGroundingCorpus(parts: GroundingParts): GroundingCorpus {
  return {
    evidence: new Set(numberTokens(parts.evidence.filter(Boolean).join(" \n "))),
    pack: new Set(numberTokens(parts.pack.filter(Boolean).join(" \n "))),
  };
}

/** Grounded as a fact about the practice — assertable anywhere the brief speaks. */
export function isNumberGrounded(token: string, corpus: GroundingCorpus): boolean {
  return corpus.evidence.has(token);
}

/**
 * Every number in `text` — digit OR word — that the corpus does not contain.
 *
 * Word-numbers are folded to digits first (`wordNumbersToDigits`), because the model reaches
 * for the word form under exactly the pressure meant to stop it (P2-7). Then the two things
 * the brief may say WITHOUT evidence are stripped: the length of the meeting we propose
 * (`MEETING_DURATION`) and the length of our ask (`OUR_ASK_DURATION`). What remains and is
 * ungrounded is a fabricated statistic.
 *
 * `allowPack` is true ONLY for a rebuttal, the one field where the prompt lets the writer
 * reach for the pack's proof point. Everywhere else a pack number is a claim about someone
 * else's practice, dressed as a claim about this one, and is rejected (P1-3).
 */
export function ungroundedNumbers(
  text: string,
  corpus: GroundingCorpus,
  allowPack = false,
): string[] {
  const withoutOurAsk = wordNumbersToDigits(text)
    .replace(MEETING_DURATION, " ")
    .replace(OUR_ASK_DURATION, " ");
  const ungrounded = numberTokens(withoutOurAsk).filter(
    (token) => !corpus.evidence.has(token) && !(allowPack && corpus.pack.has(token)),
  );
  return [...new Set(ungrounded)];
}

/** Every banned phrase present in `text`, in `AI_TELLS` order so the report is stable. */
export function aiTells(text: string): string[] {
  const normalized = text.toLowerCase().replace(WHITESPACE_RUN, " ");
  return AI_TELLS.filter((tell) => normalized.includes(tell));
}

/**
 * Fuzzy counts that overclaim from thin evidence. The live opener read "I saw a couple of
 * patients mention…" when we supplied exactly ONE review (P2-8). No other gate can see it:
 * closure checks THAT the review exists, never HOW MANY, and there is no digit for the truth
 * gate to catch. This is not banned outright — a touch body's "most practices never see the
 * calls that ring out" is a legitimate market generalization — so `lintVoice` applies it only
 * to the fields that speak about THIS practice.
 */
const VAGUE_QUANTIFIERS: readonly string[] = [
  "a couple",
  "a few",
  "several",
  "dozens of",
  "many of your",
  "a handful of",
];

/** The fields whose subject is the practice itself, where an invented quantity is a lie. */
const QUANTIFIER_SCOPED_FIELDS: ReadonlySet<string> = new Set([
  "headline",
  "callOpener",
  "personalizationSnippet",
]);

/**
 * "Got a few minutes?" quantifies OUR ask, not the evidence — the same distinction the
 * duration exemptions draw. Strip a vague quantifier bound to a time unit before checking, so
 * a natural CTA does not cost a retry, while "a few patients" (no time unit) still fires.
 */
const VAGUE_TIME_ASK =
  /\b(?:a couple of|a couple|a few|several)\s+(?:seconds?|minutes?|mins?|moments?)\b/gi;

/** Vague quantifiers present in `text`, in list order so the report is stable. */
export function vagueQuantifiers(text: string): string[] {
  const normalized = text.toLowerCase().replace(WHITESPACE_RUN, " ").replace(VAGUE_TIME_ASK, " ");
  return VAGUE_QUANTIFIERS.filter((q) => normalized.includes(q));
}

/** Sentences over the word ceiling, returned as their word counts. */
export function longSentences(text: string): number[] {
  return text
    .split(SENTENCE_SPLIT)
    .map((sentence) => sentence.trim().split(WHITESPACE_RUN).filter(Boolean).length)
    .filter((words) => words > MAX_SENTENCE_WORDS);
}

export function emDashCount(text: string): number {
  return (text.match(EM_DASH) ?? []).length;
}

/**
 * A rebuttal is the ONE field the prompt lets quote the pack's proof point ("agrees first,
 * then reframes, then points at the pack's proof"), so it is the one field where a pack
 * number is grounded. Every other field asserts about the practice, and a pack number there
 * is a fabrication.
 */
const REBUTTAL_FIELD = /^objections\[\d+\]\.rebuttal$/;

/** Run every gate over every field of model-authored prose. */
export function lintVoice(voice: VoiceBrief, corpus: GroundingCorpus): LintResult {
  const violations: Violation[] = [];

  for (const { field, text } of voiceProseFields(voice)) {
    const allowPack = REBUTTAL_FIELD.test(field);
    for (const token of ungroundedNumbers(text, corpus, allowPack)) {
      violations.push({
        kind: "ungrounded-number",
        field,
        detail: `the number "${token}" does not appear anywhere in the evidence — remove it or replace it with a phrase that needs no number`,
      });
    }
    for (const tell of aiTells(text)) {
      violations.push({
        kind: "ai-tell",
        field,
        detail: `remove the phrase "${tell}" — say the specific thing instead`,
      });
    }
    for (const words of longSentences(text)) {
      violations.push({
        kind: "long-sentence",
        field,
        detail: `a ${words}-word sentence; split it so no sentence exceeds ${MAX_SENTENCE_WORDS} words`,
      });
    }
    const dashes = emDashCount(text);
    if (dashes > MAX_EM_DASHES_PER_FIELD) {
      violations.push({
        kind: "em-dash-overuse",
        field,
        detail: `${dashes} em dashes; use at most ${MAX_EM_DASHES_PER_FIELD} and prefer a full stop`,
      });
    }
    if (QUANTIFIER_SCOPED_FIELDS.has(field)) {
      for (const quantifier of vagueQuantifiers(text)) {
        violations.push({
          kind: "vague-quantifier",
          field,
          detail: `remove "${quantifier}" — do not quantify the evidence; if it is one review, write "a patient", not "${quantifier}"`,
        });
      }
    }
  }

  return { ok: violations.length === 0, violations };
}

/**
 * Violations, rendered for the retry turn. Handed straight to the model as a user
 * message — so it reads as a specific edit list ("in sequence.touches[1].body, the
 * number 40 does not appear in the evidence"), never as "try again".
 */
export function formatViolations(violations: readonly Violation[]): string {
  return violations.map((v) => `- ${v.field}: ${v.detail}`).join("\n");
}
