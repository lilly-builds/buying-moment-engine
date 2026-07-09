import { describe, expect, it } from "vitest";
import {
  AI_TELLS,
  MAX_EM_DASHES_PER_FIELD,
  MAX_SENTENCE_WORDS,
  aiTells,
  buildGroundingCorpus,
  emDashCount,
  formatViolations,
  isNumberGrounded,
  lintVoice,
  longSentences,
  normalizeForGrounding,
  ungroundedNumbers,
  vagueQuantifiers,
  wordNumbersToDigits,
} from "@/src/brief/lint";
import type { VoiceBrief } from "@/src/brief/schema";

/**
 * The lint is the only thing standing between a schema-valid brief and a fabricated
 * number in an AE's opener. These tests pin the two properties that make it worth
 * having: it catches a number the evidence never contained, and it does NOT catch a
 * number the evidence did.
 */

const EVIDENCE = [
  "Texas Dermatology fields 2,000 calls per month handled by Elise.",
  "In-person dermatology clinic no-show rate: 13.4% (711 of 5,315 visits).",
  "Average cost per no-show: $196 (2008 dollars).",
  "Schlessinger MD has served South Florida since 2004.",
];

/**
 * The pack's OWN cited figures. `600` and `250` are the pack's proof point — real, but they
 * belong to Texas Dermatology, not the prospect — so they are grounded ONLY inside a rebuttal
 * and are a fabrication anywhere else (P1-3). They are deliberately NOT in `EVIDENCE`.
 */
const PACK = ["Texas Dermatology books 600 appointments and 250 new patients per month."];

const CORPUS = buildGroundingCorpus({ evidence: EVIDENCE, pack: PACK });

function voice(overrides: Partial<VoiceBrief> = {}): VoiceBrief {
  return {
    headline: "Front desk is drowning in calls",
    headlineEvidenceIds: [],
    callOpener: "Most derm groups your size lose the phone battle at screening season.",
    callOpenerEvidenceIds: [],
    personalizationSnippet: "You have been in South Florida since 2004.",
    personalizationEvidenceIds: [],
    sequence: {
      touches: [
        { touchNumber: 1, channel: "email", subject: "Missed calls", body: "Quick note.", evidenceIds: [] },
        { touchNumber: 2, channel: "call", subject: "Following", body: "Second note.", evidenceIds: [] },
        { touchNumber: 3, channel: "email", subject: "Last one", body: "Third note.", evidenceIds: [] },
      ],
      namedCta: "Book a 15 minute call",
    },
    discoveryQuestions: ["How many calls ring out at lunch?", "Who covers the phones then?"],
    objections: [
      { objection: "We already have a service", rebuttal: "Most do." },
      { objection: "Too expensive", rebuttal: "It pays for itself." },
      { objection: "Patients hate robots", rebuttal: "They hate hold music more." },
    ],
    ...overrides,
  };
}

describe("normalizeForGrounding", () => {
  it("strips thousands separators so 2,000 and 2000 are the same number", () => {
    expect(normalizeForGrounding("2,000 calls")).toBe("2000 calls");
  });

  it("does not strip a comma that is not between digits", () => {
    expect(normalizeForGrounding("Tampa, FL")).toBe("tampa, fl");
  });

  it("collapses whitespace and lowercases", () => {
    expect(normalizeForGrounding("  Foo\n\tBAR  ")).toBe("foo bar");
  });
});

describe("buildGroundingCorpus / isNumberGrounded", () => {
  it("holds each maximal number token the evidence actually wrote", () => {
    expect([...CORPUS.evidence].sort()).toEqual(
      ["13.4", "196", "2000", "2004", "2008", "5315", "711"].sort(),
    );
  });

  it("keeps the pack's figures in a separate set, not the evidence one", () => {
    expect([...CORPUS.pack].sort()).toEqual(["250", "600"].sort());
    // The pack's numbers are NOT evidence numbers: they belong to another practice.
    expect(isNumberGrounded("250", CORPUS)).toBe(false);
    expect(isNumberGrounded("600", CORPUS)).toBe(false);
  });

  it("matches a number that is present", () => {
    expect(isNumberGrounded("2000", CORPUS)).toBe(true);
  });

  it("refuses a number that is only a FRAGMENT of a longer one", () => {
    // The corpus holds "2,000" -> "2000". A substring check would pass "200".
    // A practice fielding 2,000 calls does not field 200, and the brief must not say so.
    expect(isNumberGrounded("200", CORPUS)).toBe(false);
  });

  it("matches a decimal exactly", () => {
    expect(isNumberGrounded("13.4", CORPUS)).toBe(true);
  });

  it("does not treat a decimal's leading part as grounded", () => {
    // A digit-boundary regex reads "13.4" as containing "13", because "." is not a
    // digit. Set membership over maximal tokens cannot make that mistake.
    expect(isNumberGrounded("13", CORPUS)).toBe(false);
  });

  it("drops null and undefined parts rather than stringifying them", () => {
    const corpus = buildGroundingCorpus({ evidence: ["saw 5 of them", null, undefined], pack: [] });
    expect([...corpus.evidence]).toEqual(["5"]);
  });
});

describe("ungroundedNumbers — the pack's proof grounds a rebuttal and nothing else (P1-3)", () => {
  it("flags a pack proof number asserted as a fact about the practice", () => {
    // The exploit that composed two holes into one: the pack's 250 new patients, stated
    // about the prospect, citing nothing. With the corpus split it is ungrounded here.
    expect(ungroundedNumbers("You are losing 250 new patients a month to voicemail.", CORPUS)).toEqual([
      "250",
    ]);
  });

  it("allows the same pack number inside a rebuttal, where the prompt permits the proof", () => {
    expect(
      ungroundedNumbers("Texas Dermatology books 250 new patients a month with Elise.", CORPUS, true),
    ).toEqual([]);
  });

  it("still flags a number that is in NEITHER set, even inside a rebuttal", () => {
    expect(ungroundedNumbers("We book 999 new patients a month.", CORPUS, true)).toEqual(["999"]);
  });
});

describe("ungroundedNumbers", () => {
  it("passes numbers the evidence contains", () => {
    expect(ungroundedNumbers("They handle 2,000 calls and 13.4% no-shows.", CORPUS)).toEqual([]);
  });

  it("catches a fabricated percentage", () => {
    expect(ungroundedNumbers("You will cut no-shows 40%.", CORPUS)).toEqual(["40"]);
  });

  it("catches an invented location count", () => {
    expect(ungroundedNumbers("Across your 12 locations...", CORPUS)).toEqual(["12"]);
  });

  it("catches 24/7 as two ungrounded numbers, which is why the prompt bans it", () => {
    expect(ungroundedNumbers("We answer 24/7.", CORPUS)).toEqual(["24", "7"]);
  });

  it("de-duplicates a number repeated in one field", () => {
    expect(ungroundedNumbers("40% here, 40% there.", CORPUS)).toEqual(["40"]);
  });

  it("grounds a number even when a comma or period immediately follows it (found live)", () => {
    // The live call wrote "...serving Omaha since 2004, and...". 2004 is grounded; the comma
    // is punctuation. A tokenizer that read "2004," as a distinct number falsely rejected it.
    expect(ungroundedNumbers("You have served Omaha since 2004, and it shows.", CORPUS)).toEqual([]);
    expect(ungroundedNumbers("Founded in 2004. Still going.", CORPUS)).toEqual([]);
  });

  it("now catches written-out numbers — the model reaches for the word form under pressure (P2-7)", () => {
    expect(ungroundedNumbers("Across your twelve locations.", CORPUS)).toEqual(["12"]);
    expect(ungroundedNumbers("You lose forty percent of new-patient calls.", CORPUS)).toEqual(["40"]);
  });

  it("leaves the pronoun 'one' alone, and ordinals with it (P2-7)", () => {
    // "one" is a pronoun far more often than a count; ordinals only look like cardinals.
    expect(ungroundedNumbers("One reply is one click away. On our second call, we talk.", CORPUS)).toEqual([]);
  });

  it("folds a scaled word-number and catches it when ungrounded (P2-7)", () => {
    expect(ungroundedNumbers("You field three thousand calls a month.", CORPUS)).toEqual(["3000"]);
  });

  // ─── the meeting-duration exemption, and the ways it must NOT leak ────────────
  it("allows the length of the meeting we are proposing", () => {
    expect(ungroundedNumbers("Worth a 15-minute call next week?", CORPUS)).toEqual([]);
    expect(ungroundedNumbers("Grab a 20 minute chat?", CORPUS)).toEqual([]);
    expect(ungroundedNumbers("Book a 15 min intro.", CORPUS)).toEqual([]);
  });

  it("exempts the length only when it is one we would actually propose (P2-6)", () => {
    // The old pattern took ANY number before a meeting noun. A fabricated duration about the
    // prospect ("a 12 minute call") is not our ask, and is no longer laundered.
    expect(ungroundedNumbers("Patients sit through a 12 minute call before anyone picks up.", CORPUS)).toEqual(["12"]);
    expect(ungroundedNumbers("Every new patient waits on a 9 minute call.", CORPUS)).toEqual(["9"]);
    expect(ungroundedNumbers("Your team burns a 7 minute call on every reschedule.", CORPUS)).toEqual(["7"]);
  });

  it("exempts our ask stated as words, in minutes or seconds (P2-7)", () => {
    expect(ungroundedNumbers("Mind if I take thirty seconds?", CORPUS)).toEqual([]);
    expect(ungroundedNumbers("A fifteen-minute look at your call flow next week?", CORPUS)).toEqual([]);
    expect(ungroundedNumbers("Give me twenty minutes and I will show you.", CORPUS)).toEqual([]);
  });

  it("still flags a duration stated as a claim about THEIR time, even in words (P2-7)", () => {
    // "we save thirty seconds a call" is a statistic — no ask verb governs it.
    expect(ungroundedNumbers("We save thirty seconds on every call you take.", CORPUS)).toEqual(["30"]);
  });

  it("does not let the exemption launder a statistic — no unit means no exemption", () => {
    expect(ungroundedNumbers("We cut no-shows 45%.", CORPUS)).toEqual(["45"]);
  });

  it("does not let the exemption launder a claim about THEIR minutes", () => {
    // "minutes" is present, but "hold time" is not a meeting noun. Still a claim.
    expect(ungroundedNumbers("Patients wait 15 minutes of hold time.", CORPUS)).toEqual(["15"]);
  });

  it("does not let a PLURAL unit launder a claim that happens to precede a meeting noun", () => {
    // The hole this closes: "30 minutes call handling" matched a plural-tolerant pattern
    // and exempted a fabricated statistic about the practice's own day. A duration
    // adjective is singular ("a 15-minute call"); a claim about their time is not.
    expect(ungroundedNumbers("We save 30 minutes call handling time daily.", CORPUS)).toEqual(["30"]);
    expect(ungroundedNumbers("Staff lose 45 minutes call triage each morning.", CORPUS)).toEqual(["45"]);
  });
});

describe("wordNumbersToDigits", () => {
  it("folds units, tens, compounds and scales into digits", () => {
    expect(wordNumbersToDigits("forty percent")).toBe("40 %");
    expect(wordNumbersToDigits("twenty-five")).toBe("25");
    expect(wordNumbersToDigits("twenty five")).toBe("25");
    expect(wordNumbersToDigits("two thousand calls")).toBe("2000 calls");
    expect(wordNumbersToDigits("fifteen-minute look")).toBe("15-minute look");
  });

  it("leaves 'one' and ordinals untouched", () => {
    expect(wordNumbersToDigits("one reply, second touch, third call")).toBe(
      "one reply, second touch, third call",
    );
  });

  it("does not fold a number-word buried inside another word", () => {
    // Word boundaries keep "often" and "Twentynine Palms" intact.
    expect(wordNumbersToDigits("often in Twentynine Palms")).toBe("often in Twentynine Palms");
  });
});

describe("aiTells", () => {
  it("catches the classic cold-email opener regardless of case", () => {
    expect(aiTells("I Hope This Email Finds You Well.")).toContain("hope this email finds you well");
  });

  it("catches vendor filler", () => {
    expect(aiTells("Leverage our seamless, cutting-edge platform.")).toEqual(
      expect.arrayContaining(["leverage", "seamless", "cutting-edge"]),
    );
  });

  it("collapses whitespace before matching, so a line break cannot smuggle a tell through", () => {
    expect(aiTells("I wanted\nto reach   out")).toContain("wanted to reach out");
  });

  it("does not fire on legitimate prose that merely shares a word", () => {
    // We ban "streamline your" / "unlock your" / "elevate your", never the bare verb.
    expect(aiTells("This will streamline scheduling for the front desk.")).toEqual([]);
    expect(aiTells("Reach out when you have five minutes.")).toEqual([]);
  });

  it("has no entry that is a substring of another (each earns its own report line)", () => {
    for (const tell of AI_TELLS) {
      const swallowed = AI_TELLS.filter((other) => other !== tell && other.includes(tell));
      expect(swallowed, `"${tell}" is swallowed by ${JSON.stringify(swallowed)}`).toEqual([]);
    }
  });
});

describe("vagueQuantifiers (P2-8)", () => {
  it("finds each fuzzy count, case-insensitively", () => {
    expect(vagueQuantifiers("I saw A Couple Of patients and several others.")).toEqual(
      expect.arrayContaining(["a couple", "several"]),
    );
  });

  it("does not fire on a precise, honest phrasing", () => {
    expect(vagueQuantifiers("A patient wrote that they could not get through.")).toEqual([]);
  });

  it("does not fire on a vague TIME ask — that quantifies our ask, not the evidence (finding 3)", () => {
    expect(vagueQuantifiers("Got a few minutes this week?")).toEqual([]);
    expect(vagueQuantifiers("Grab a couple of minutes and I will show you.")).toEqual([]);
    // But the same quantifier on a countable noun still fires.
    expect(vagueQuantifiers("A few patients mentioned it.")).toEqual(["a few"]);
  });
});

describe("longSentences", () => {
  it("passes a normal sentence", () => {
    expect(longSentences("The front desk is underwater.")).toEqual([]);
  });

  it("flags a runaway sentence with its word count", () => {
    const runaway = `${Array.from({ length: MAX_SENTENCE_WORDS + 3 }, () => "word").join(" ")}.`;
    expect(longSentences(runaway)).toEqual([MAX_SENTENCE_WORDS + 3]);
  });

  it("judges each sentence separately", () => {
    const long = Array.from({ length: MAX_SENTENCE_WORDS + 1 }, () => "word").join(" ");
    expect(longSentences(`Short one. ${long}.`)).toEqual([MAX_SENTENCE_WORDS + 1]);
  });
});

describe("emDashCount", () => {
  it("counts em dashes and not hyphens or en dashes", () => {
    expect(emDashCount("a—b—c")).toBe(2);
    expect(emDashCount("a-b–c")).toBe(0);
  });
});

describe("lintVoice", () => {
  it("passes a clean brief", () => {
    expect(lintVoice(voice(), CORPUS)).toEqual({ ok: true, violations: [] });
  });

  it("names the exact field of an ungrounded number so the retry is actionable", () => {
    const result = lintVoice(
      voice({
        sequence: {
          ...voice().sequence,
          touches: [
            { touchNumber: 1, channel: "email", subject: "Hi", body: "You will save 40%.", evidenceIds: [] },
            { touchNumber: 2, channel: "call", subject: "Hi", body: "Second.", evidenceIds: [] },
            { touchNumber: 3, channel: "email", subject: "Hi", body: "Third.", evidenceIds: [] },
          ],
        },
      }),
      CORPUS,
    );
    expect(result.ok).toBe(false);
    expect(result.violations).toEqual([
      {
        kind: "ungrounded-number",
        field: "sequence.touches[0].body",
        detail: expect.stringContaining('"40"'),
      },
    ]);
  });

  it("sweeps objections and discovery questions, which carry no evidence ids", () => {
    const result = lintVoice(
      voice({
        discoveryQuestions: ["How do you handle the 500 calls a day?", "Who covers lunch?"],
        objections: [
          { objection: "We are locked in until 2029", rebuttal: "Most are." },
          { objection: "Too expensive", rebuttal: "It pays for itself." },
          { objection: "Patients hate robots", rebuttal: "They hate hold music more." },
        ],
      }),
      CORPUS,
    );
    const fields = result.violations.map((v) => v.field);
    expect(fields).toContain("discoveryQuestions[0]");
    expect(fields).toContain("objections[0].objection");
  });

  it("lets a rebuttal quote a real proof-point metric from the corpus", () => {
    const result = lintVoice(
      voice({
        objections: [
          { objection: "Will it work?", rebuttal: "Texas Dermatology sees 2,000 calls a month handled." },
          { objection: "Too expensive", rebuttal: "It pays for itself." },
          { objection: "Patients hate robots", rebuttal: "They hate hold music more." },
        ],
      }),
      CORPUS,
    );
    expect(result.ok).toBe(true);
  });

  it("rejects a pack proof number in a touch body but accepts it in a rebuttal (P1-3)", () => {
    // 250 is the pack's own figure. Asserted about the prospect it is a fabrication; quoted as
    // the proof point in a rebuttal it is exactly what the prompt asks for.
    const inTouch = lintVoice(
      voice({
        sequence: {
          ...voice().sequence,
          touches: [
            { touchNumber: 1, channel: "email", subject: "Hi", body: "You are losing 250 new patients a month.", evidenceIds: [] },
            { touchNumber: 2, channel: "call", subject: "Hi", body: "Second.", evidenceIds: [] },
            { touchNumber: 3, channel: "email", subject: "Hi", body: "Third.", evidenceIds: [] },
          ],
        },
      }),
      CORPUS,
    );
    expect(inTouch.violations).toContainEqual({
      kind: "ungrounded-number",
      field: "sequence.touches[0].body",
      detail: expect.stringContaining('"250"'),
    });

    const inRebuttal = lintVoice(
      voice({
        objections: [
          { objection: "Will it work?", rebuttal: "Texas Dermatology books 250 new patients a month." },
          { objection: "Too expensive", rebuttal: "It pays for itself." },
          { objection: "Patients hate robots", rebuttal: "They hate hold music more." },
        ],
      }),
      CORPUS,
    );
    expect(inRebuttal.ok).toBe(true);
  });

  it("flags a fuzzy count in a field that speaks about the practice (P2-8)", () => {
    // The live opener: "I saw a couple of patients mention…" — from exactly one review.
    const result = lintVoice(
      voice({ callOpener: "I saw a couple of patients mention they could not get through." }),
      CORPUS,
    );
    expect(result.violations).toContainEqual({
      kind: "vague-quantifier",
      field: "callOpener",
      detail: expect.stringContaining("a couple"),
    });
  });

  it("does NOT flag a market generalization in a touch body (P2-8)", () => {
    // "several practices your size" is a claim about the MARKET, not this practice, and a
    // touch body is out of scope. Only headline/callOpener/personalizationSnippet are checked.
    const result = lintVoice(
      voice({
        sequence: {
          ...voice().sequence,
          touches: [
            { touchNumber: 1, channel: "email", subject: "Hi", body: "Several practices your size miss calls at lunch.", evidenceIds: [] },
            { touchNumber: 2, channel: "call", subject: "Hi", body: "Second.", evidenceIds: [] },
            { touchNumber: 3, channel: "email", subject: "Hi", body: "Third.", evidenceIds: [] },
          ],
        },
      }),
      CORPUS,
    );
    expect(result.violations.filter((v) => v.kind === "vague-quantifier")).toEqual([]);
  });

  it("flags an em-dash pile-up", () => {
    const dashes = `a${"—".repeat(MAX_EM_DASHES_PER_FIELD + 1)}b`;
    const result = lintVoice(voice({ headline: dashes }), CORPUS);
    expect(result.violations).toContainEqual({
      kind: "em-dash-overuse",
      field: "headline",
      detail: expect.stringContaining(`${MAX_EM_DASHES_PER_FIELD + 1} em dashes`),
    });
  });

  it("skips the headline on the zero-signal variant, where it is null", () => {
    // A null headline must not crash the sweep, and must not be reported as a field.
    const result = lintVoice(voice({ headline: null }), CORPUS);
    expect(result.ok).toBe(true);
  });

  it("reports every violation, not just the first — one retry must fix them all", () => {
    const result = lintVoice(
      voice({ headline: "Leverage 40% seamless growth" }),
      CORPUS,
    );
    const kinds = result.violations.filter((v) => v.field === "headline").map((v) => v.kind);
    expect(kinds).toEqual(
      expect.arrayContaining(["ungrounded-number", "ai-tell"]),
    );
    expect(result.violations.filter((v) => v.kind === "ai-tell").length).toBeGreaterThanOrEqual(2);
  });
});

describe("formatViolations", () => {
  it("renders an edit list the model can act on", () => {
    const text = formatViolations([
      { kind: "ungrounded-number", field: "callOpener", detail: 'the number "40" does not appear' },
    ]);
    expect(text).toBe('- callOpener: the number "40" does not appear');
  });
});
