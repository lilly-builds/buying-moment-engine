import { describe, expect, it } from "vitest";
import {
  CURLY_QUOTE_SPAN,
  SCHLESSINGER_TEAM_TEXT,
  SCHLESSINGER_TEAM_URL,
  STITCHED_PROVIDER_COUNT,
  VERBATIM_SPAN,
} from "./fixtures/schlessinger-team-page";
import { normalizeForCitation, verifyFindings } from "@/src/enrich/citations";
import { isEmptyFindings } from "@/src/enrich/research-schema";
import type { CitedFact, ResearchFindings } from "@/src/enrich/types";

/**
 * D2/R5 — "the brief never states an uncited fact" — stops being a sentence in a
 * prompt here and becomes an assertion. Pure: no network, no DB, no mocks.
 */

const TEAM = SCHLESSINGER_TEAM_URL;
const HOME = "https://www.schlessingermd.com";
const HOME_TEXT = "# Schlessinger MD Dermatology & Cosmetic Surgery\n\nOmaha dermatologist since 1993.";

function pages(entries: [string, string][] = [[TEAM, SCHLESSINGER_TEAM_TEXT], [HOME, HOME_TEXT]]) {
  return new Map(entries);
}

/**
 * `value` defaults to the snippet itself, so a fact is a QUOTATION of its own evidence
 * unless a test deliberately says otherwise. The default has to satisfy the containment
 * check: a helper that quietly produced `value: "value"` would make every QUOTATION-field
 * test in this file pass for the wrong reason — by being dropped.
 */
function fact(snippet: string, sourceUrl = TEAM, value = snippet): CitedFact {
  return { value, sourceUrl, snippet };
}

function findings(over: Partial<ResearchFindings> = {}): ResearchFindings {
  return {
    firmographics: {},
    ehr: null,
    incumbentTooling: [],
    decisionMaker: null,
    buyingMomentContext: [],
    ...over,
  };
}

describe("normalizeForCitation — applied to BOTH sides, never to one", () => {
  it("lowercases, collapses whitespace runs, and trims", () => {
    expect(normalizeForCitation("  Our\n\nTeam \t is  Here ")).toBe("our team is here");
  });

  it("unifies curly quotes and en/em dashes", () => {
    expect(normalizeForCitation("“Dr. O’Neil” — board‑certified")).toBe(
      // The non-breaking hyphen in "board‑certified" is NOT normalized: only en/em
      // dashes are. Widening the class is an untested loosening (E7 measured this one).
      '"dr. o\'neil" - board‑certified',
    );
  });

  it("is idempotent — normalizing twice changes nothing", () => {
    const once = normalizeForCitation(SCHLESSINGER_TEAM_TEXT);
    expect(normalizeForCitation(once)).toBe(once);
  });
});

describe("verifyFindings — the real captured fabrication", () => {
  it("DROPS the stitched Schlessinger provider tally, against the real team page", () => {
    // E7 round 1: every name is real, the comma-joined SEQUENCE is not. On the page
    // they are three separate headings. This is the whole reason the file exists —
    // if `citations.ts` is deleted, this test fails and nothing else notices.
    const stitched = fact(STITCHED_PROVIDER_COUNT, TEAM, "5 providers");
    const result = verifyFindings(findings({ buyingMomentContext: [stitched] }), pages());

    expect(result.verified.buyingMomentContext).toEqual([]);
    expect(result.dropped).toEqual([
      {
        field: "buyingMomentContext[0]",
        reason: "snippet-not-verbatim",
        value: "5 providers",
        sourceUrl: TEAM,
        snippet: STITCHED_PROVIDER_COUNT,
      },
    ]);
  });

  it("KEEPS a genuine contiguous span from the same page (the positive control)", () => {
    const good = fact(VERBATIM_SPAN, TEAM, "dermatology");
    const result = verifyFindings(findings({ firmographics: { specialty: good } }), pages());

    expect(result.verified.firmographics.specialty).toEqual(good);
    expect(result.dropped).toEqual([]);
  });

  it("a snippet on page A cited to page B is dropped — provenance, not mere existence", () => {
    // VERBATIM_SPAN is real, and really on the TEAM page. Cited to HOME, it is a lie
    // about where the evidence lives, and the brief would link a reader to a page
    // that does not say it.
    const misattributed = fact(VERBATIM_SPAN, HOME);
    const result = verifyFindings(findings({ ehr: misattributed }), pages());

    expect(result.verified.ehr).toBeNull();
    expect(result.dropped).toEqual([
      {
        field: "ehr",
        reason: "snippet-not-verbatim",
        value: VERBATIM_SPAN,
        sourceUrl: HOME,
        snippet: VERBATIM_SPAN,
      },
    ]);
  });
});

/**
 * R1. The gate that did not exist: `verifyFact` read `sourceUrl` and `snippet` and never
 * touched `value` — the string the brief actually renders. A real quotation, lifted off a
 * real page, could be attached to any claim at all and sail through with `dropped: []`.
 */
describe("verifyFindings — the snippet must SUPPORT the value, not merely exist", () => {
  const PORTAL = "https://www.schlessingermd.com/patient-portal";
  const PORTAL_TEXT = "# Patient portal\n\nOur patient portal is powered by ModMed EMA.";
  const PORTAL_SPAN = "Our patient portal is powered by ModMed EMA.";
  const held = () => pages([[PORTAL, PORTAL_TEXT], [HOME, HOME_TEXT]]);

  it("DROPS a fabricated value carried on a genuine snippet from the page it cites", () => {
    // Every previous check passes: the URL is one we hold, and the snippet is verbatim
    // on it. The brief would have printed "EHR: Epic" under a link to a page that says
    // ModMed. Delete the `value-not-in-snippet` gate and this test is the only thing
    // that notices.
    const epic: CitedFact = { value: "Epic", sourceUrl: PORTAL, snippet: PORTAL_SPAN };
    const result = verifyFindings(findings({ ehr: epic }), held());

    expect(result.verified.ehr).toBeNull();
    expect(result.dropped).toEqual([
      {
        field: "ehr",
        reason: "value-not-in-snippet",
        value: "Epic",
        sourceUrl: PORTAL,
        snippet: PORTAL_SPAN,
      },
    ]);
  });

  it("KEEPS the same snippet when the value IS inside it (the positive control)", () => {
    const modmed: CitedFact = { value: "ModMed EMA", sourceUrl: PORTAL, snippet: PORTAL_SPAN };
    const result = verifyFindings(findings({ ehr: modmed }), held());

    expect(result.verified.ehr).toEqual(modmed);
    expect(result.dropped).toEqual([]);
  });

  it("normalizes BOTH sides of the value check — case and spacing never fabricate", () => {
    const modmed: CitedFact = { value: "  MODMED   ema ", sourceUrl: PORTAL, snippet: PORTAL_SPAN };
    expect(verifyFindings(findings({ ehr: modmed }), held()).dropped).toEqual([]);
  });

  it("yearFounded is a QUOTATION: '1993' verifies, '1994' is dropped", () => {
    const good = { value: "1993", sourceUrl: HOME, snippet: "Omaha dermatologist since 1993" };
    const bad = { value: "1994", sourceUrl: HOME, snippet: "Omaha dermatologist since 1993" };

    expect(
      verifyFindings(findings({ firmographics: { yearFounded: good } }), held()).verified
        .firmographics.yearFounded,
    ).toEqual(good);
    expect(
      verifyFindings(findings({ firmographics: { yearFounded: bad } }), held()).dropped[0],
    ).toMatchObject({ field: "firmographics.yearFounded", reason: "value-not-in-snippet" });
  });

  it("a whitespace-only VALUE on a real snippet is dropped, not trivially verified", () => {
    // `"anything".includes("")` again, one layer in. Zod's `min(1)` accepts "   ".
    const blank: CitedFact = { value: "   ", sourceUrl: PORTAL, snippet: PORTAL_SPAN };
    expect(verifyFindings(findings({ ehr: blank }), held()).dropped[0]?.reason).toBe(
      "value-not-in-snippet",
    );
  });

  describe("the value must appear as a WHOLE SPAN — a substring is not a word", () => {
    // EHR vendor names nest inside one another, which is the worst case in the language:
    // `Epic` ⊂ `Epicare`, `Athena` ⊂ `AthenaHealth`, `EMA` ⊂ `ModMedEMA`. A plain
    // `includes()` reports every one of these as a verified quotation.
    const onPage = (snippet: string) => new Map([[PORTAL, `# Portal\n\n${snippet}`]]);

    it.each([
      ["Epic", "We use Epicare for scheduling."],
      ["Athena", "Our AthenaHealth portal is live."],
      ["EMA", "Records live in ModMedEMA today."],
    ])("DROPS %o cited to a snippet that only says it inside a longer word", (value, snippet) => {
      const fabricated: CitedFact = { value, sourceUrl: PORTAL, snippet };
      const result = verifyFindings(findings({ ehr: fabricated }), onPage(snippet));
      expect(result.dropped[0]).toMatchObject({ reason: "value-not-in-snippet", value });
    });

    it("DROPS role 'COO' cited to '## Cosmetic coordinators' — on the REAL captured page", () => {
      // Found by review, against `SCHLESSINGER_TEAM_TEXT`. `"coo"` is a substring of
      // `"coordinators"`, so a plain `includes()` verified a fabricated C-suite title,
      // the contact survived on it, and `waterfall.ts` then paid PDL to enrich
      // `(practice, role="COO")`. Substring, not word — which is why it is a word check.
      const result = verifyFindings(
        findings({
          decisionMaker: {
            name: null,
            role: fact("## Cosmetic coordinators", TEAM, "COO"),
            email: null,
            linkedinUrl: null,
          },
        }),
        pages(),
      );

      expect(result.verified.decisionMaker).toBeNull();
      expect(result.dropped[0]).toMatchObject({
        field: "decisionMaker.role",
        reason: "value-not-in-snippet",
        value: "COO",
      });
    });

    it("DROPS a yearFounded whose digits are a prefix of a longer number", () => {
      const snippet = "Founded 19934 patients ago.";
      const bad: CitedFact = { value: "1993", sourceUrl: PORTAL, snippet };
      expect(
        verifyFindings(findings({ firmographics: { yearFounded: bad } }), onPage(snippet))
          .dropped[0],
      ).toMatchObject({ reason: "value-not-in-snippet" });
    });

    it("DROPS an email whose local-part is a suffix of the address on the page", () => {
      const snippet = "Contact xdana@sunshinederm.example today";
      const bad: CitedFact = {
        value: "dana@sunshinederm.example",
        sourceUrl: PORTAL,
        snippet,
      };
      const result = verifyFindings(
        findings({
          decisionMaker: {
            name: null,
            role: { value: "Practice Manager", sourceUrl: PORTAL, snippet: "The Practice Manager" },
            email: bad,
            linkedinUrl: null,
          },
        }),
        new Map([[PORTAL, `# Portal\n\n${snippet}\n\nThe Practice Manager`]]),
      );
      expect(result.dropped.map((d) => d.field)).toEqual(["decisionMaker.email"]);
    });

    it("the boundary is only required where the VALUE's own edge is a word character", () => {
      // A value that already carries punctuation at an edge cannot be asked to sit next
      // to a non-word character there. Requiring it unconditionally would false-drop.
      const cases: Array<[string, string]> = [
        ["(512) 328-3376", "Call us at (512) 328-3376 today."],
        ["ModMed EMA", "Our patient portal is powered by ModMed EMA."],
        ["2004", "We have served South Florida since 2004."],
        ["Daniel Schlessinger", "Dr. Daniel Schlessinger is a board-certified dermatologist"],
      ];
      for (const [value, snippet] of cases) {
        const good: CitedFact = { value, sourceUrl: PORTAL, snippet };
        expect(
          verifyFindings(findings({ ehr: good }), onPage(snippet)).dropped,
          `${value} should verify against ${snippet}`,
        ).toEqual([]);
      }
    });
  });

  it("a LABEL value need not appear in its snippet — it is the model's word FOR it", () => {
    // Containment is FALSE for these on real data, because the value's KIND differs from
    // prose (an inflection, a URL, a summary). Enforcing it would delete true facts —
    // R2 in a new costume.
    const specialty: CitedFact = {
      value: "Orthopedics",
      sourceUrl: HOME,
      snippet: "Omaha dermatologist since 1993",
    };
    const moment: CitedFact = {
      value: "They just opened a fourth office",
      sourceUrl: HOME,
      snippet: "Omaha dermatologist since 1993",
    };

    const result = verifyFindings(
      findings({ firmographics: { specialty }, buyingMomentContext: [moment] }),
      held(),
    );

    expect(result.verified.firmographics.specialty).toEqual(specialty);
    expect(result.verified.buyingMomentContext).toEqual([moment]);
    expect(result.dropped).toEqual([]);
  });

  it("incumbentTooling is a QUOTATION: a vendor name the snippet never prints is dropped", () => {
    // R1's own defect, on a different field name. `{value:"Epic", snippet:"…via Podium."}`
    // used to reach `practice_facts` as `incumbent_tooling_1` with `dropped: []`.
    const podiumPage = new Map([[PORTAL, "# Reviews\n\nReviews collected via Podium."]]);
    const snippet = "Reviews collected via Podium.";

    const good: CitedFact = { value: "Podium", sourceUrl: PORTAL, snippet };
    expect(verifyFindings(findings({ incumbentTooling: [good] }), podiumPage).verified
      .incumbentTooling).toEqual([good]);

    const fabricated: CitedFact = { value: "Epic", sourceUrl: PORTAL, snippet };
    const bad = verifyFindings(findings({ incumbentTooling: [fabricated] }), podiumPage);
    expect(bad.verified.incumbentTooling).toEqual([]);
    expect(bad.dropped[0]).toMatchObject({
      field: "incumbentTooling[0]",
      reason: "value-not-in-snippet",
      value: "Epic",
    });
  });

  it("names every surviving LABEL field on `paraphrased`, and no QUOTATION field", () => {
    // U6 reads this to know which values it may NOT wrap in quote marks.
    const label = (value: string): CitedFact => ({ value, sourceUrl: PORTAL, snippet: PORTAL_SPAN });
    const result = verifyFindings(
      findings({
        firmographics: { specialty: label("Dermatology"), website: label("schlessingermd.com") },
        ehr: { value: "ModMed EMA", sourceUrl: PORTAL, snippet: PORTAL_SPAN },
        incumbentTooling: [{ value: "ModMed EMA", sourceUrl: PORTAL, snippet: PORTAL_SPAN }],
        buyingMomentContext: [label("They run a portal")],
      }),
      held(),
    );

    expect(result.dropped).toEqual([]);
    expect(result.paraphrased.sort()).toEqual([
      "buyingMomentContext[0]",
      "firmographics.specialty",
      "firmographics.website",
    ]);
    expect(result.paraphrased).not.toContain("ehr");
    expect(result.paraphrased).not.toContain("incumbentTooling[0]");
  });

  it("a DROPPED fact never lands on `paraphrased` — it names survivors only", () => {
    const offPage: CitedFact = { value: "Anything", sourceUrl: PORTAL, snippet: "Not on the page." };
    const result = verifyFindings(findings({ buyingMomentContext: [offPage] }), held());

    expect(result.verified.buyingMomentContext).toEqual([]);
    expect(result.paraphrased).toEqual([]);
  });

  it("`paraphrased` indexes `verified`, `dropped` indexes the MODEL'S output", () => {
    // `verified.buyingMomentContext` is compacted by the drop, so the survivor moves from
    // input [1] to output [0]. A `paraphrased` entry naming `[1]` would tell U6 that
    // output slot 0 is a quotation — and it would render a paraphrase in quote marks,
    // the precise leak this field exists to prevent.
    const dropped: CitedFact = { value: "Zocdoc", sourceUrl: PORTAL, snippet: "Not on the page." };
    const kept: CitedFact = { value: "A summary", sourceUrl: PORTAL, snippet: PORTAL_SPAN };

    const result = verifyFindings(findings({ buyingMomentContext: [dropped, kept] }), held());

    expect(result.verified.buyingMomentContext).toEqual([kept]);
    expect(result.paraphrased).toEqual(["buyingMomentContext[0]"]); // where it LANDED
    expect(result.dropped[0]?.field).toBe("buyingMomentContext[0]"); // where it CAME FROM
    // The two index spaces genuinely differ; the survivor was input [1].
    expect(result.verified.buyingMomentContext[0]).toBe(kept);
  });

  it("a contact that COLLAPSES takes its paraphrased linkedinUrl with it", () => {
    // `linkedinUrl` verifies and is a LABEL, so it reaches `paraphrased` before the role
    // sinks the contact. Leaving it there would describe a fact U6 will never render.
    const result = verifyFindings(
      findings({
        decisionMaker: {
          name: null,
          role: { value: "Chief Fabrication Officer", sourceUrl: PORTAL, snippet: PORTAL_SPAN },
          email: null,
          linkedinUrl: {
            value: "https://www.linkedin.com/in/x",
            sourceUrl: PORTAL,
            snippet: PORTAL_SPAN,
          },
        },
      }),
      held(),
    );

    expect(result.verified.decisionMaker).toBeNull();
    expect(result.paraphrased).toEqual([]);
    expect(result.dropped.map((d) => [d.field, d.reason])).toEqual([
      ["decisionMaker.role", "value-not-in-snippet"],
      ["decisionMaker.linkedinUrl", "contact-role-dropped"],
    ]);
  });

  it("R2's lesson holds: the escalation path is never VALUE-checked either", () => {
    // We hold no page, so we cannot adjudicate the snippet — and the research prompt never
    // asked Sonnet to copy its values verbatim out of its snippets. Checking a contract
    // the caller never agreed to is how true facts get reported as fabrication.
    const agentic: CitedFact = {
      value: "Epic",
      sourceUrl: "https://somewhere.we.never.fetched/portal",
      snippet: "Our patient portal is powered by ModMed EMA.",
    };
    const result = verifyFindings(findings({ ehr: agentic }), new Map(), {
      unheldUrl: "keep-unverifiable",
    });

    expect(result.verified.ehr).toEqual(agentic);
    expect(result.dropped).toEqual([]);
    expect(result.unverifiable.map((d) => d.reason)).toEqual(["url-not-held"]);
  });
});

describe("verifyFindings — the URL must be one we actually hold", () => {
  it("drops a fact citing a URL absent from the page map ('url-not-held')", () => {
    const invented = fact(VERBATIM_SPAN, "https://www.schlessingermd.com/pricing");
    const result = verifyFindings(findings({ ehr: invented }), pages());

    expect(result.verified.ehr).toBeNull();
    expect(result.dropped[0]).toMatchObject({ field: "ehr", reason: "url-not-held" });
  });

  it("a fabricated URL on a DIFFERENT host is url-not-held, never silently matched", () => {
    const offsite = fact(VERBATIM_SPAN, "https://evil.example/team");
    const result = verifyFindings(findings({ ehr: offsite }), pages());
    expect(result.dropped[0]?.reason).toBe("url-not-held");
  });

  it("tolerates ONLY a trailing-slash difference — the identifier we handed the model", () => {
    // Ported from the E7 harness, which measured 0 bad URLs across 19 facts WITH this
    // tolerance in place. The slash is a URL-identity artifact, not a claim about
    // evidence; the snippet is what carries the claim.
    const held = pages([[HOME, HOME_TEXT]]);
    const trailing = fact("Omaha dermatologist since 1993", `${HOME}/`);
    expect(verifyFindings(findings({ ehr: trailing }), held).dropped).toEqual([]);

    const stripped = new Map([[`${HOME}/`, HOME_TEXT]]);
    const bare = fact("Omaha dermatologist since 1993", HOME);
    expect(verifyFindings(findings({ ehr: bare }), stripped).dropped).toEqual([]);
  });
});

describe("verifyFindings — normalization lets TRUE facts through", () => {
  it("a straight apostrophe verifies against the page's curly one", () => {
    const result = verifyFindings(findings({ ehr: fact(CURLY_QUOTE_SPAN) }), pages());
    expect(result.verified.ehr).not.toBeNull();
    expect(result.dropped).toEqual([]);
  });

  it("case differences, doubled spaces and newlines still verify", () => {
    const noisy = `  CONSISTENTLY   VOTED the best\ndermatologist and cosmetic surgeon\n\nin OMAHA  `;
    expect(verifyFindings(findings({ ehr: fact(noisy) }), pages()).dropped).toEqual([]);
  });

  it("an em-dash in the snippet matches an en-dash on the page", () => {
    const held = pages([[HOME, "Serving Omaha – since 1993"]]);
    expect(verifyFindings(findings({ ehr: fact("Omaha — since 1993", HOME) }), held).dropped).toEqual([]);
  });

  it("a whitespace-only snippet is DROPPED, not trivially verified", () => {
    // `"anything".includes("")` is true. A snippet that normalizes to nothing proves
    // nothing, and the zod gate's `min(1)` does not catch "   ".
    const result = verifyFindings(findings({ ehr: fact("   \n  ") }), pages());
    expect(result.verified.ehr).toBeNull();
    expect(result.dropped[0]?.reason).toBe("snippet-not-verbatim");
  });
});

describe("verifyFindings — the decision-maker collapses correctly", () => {
  // A real contiguous span of the real team page. `name` and `role` are QUOTATION fields
  // (a brief that gets one wrong calls the wrong person), so both values are lifted out
  // of this one sentence — exactly what `extract-prompt.ts` rule 5 asks the model for.
  const CONTACT_SPAN =
    "Dr. Daniel Schlessinger is a board-certified dermatologist, Mohs surgeon and cosmetic surgeon";
  const role = fact(CONTACT_SPAN, TEAM, "board-certified dermatologist");
  const name = fact(CONTACT_SPAN, TEAM, "Daniel Schlessinger");

  it("a dropped ROLE collapses the whole contact to null — no role, no contact", () => {
    const result = verifyFindings(
      findings({ decisionMaker: { name, role: fact("Chief Fabrication Officer"), email: null, linkedinUrl: null } }),
      pages(),
    );

    expect(result.verified.decisionMaker).toBeNull();
    expect(result.dropped).toEqual([
      { field: "decisionMaker.role", reason: "snippet-not-verbatim", value: "Chief Fabrication Officer", sourceUrl: TEAM, snippet: "Chief Fabrication Officer" },
      // The name VERIFIED. It is discarded anyway, because the contact it belonged to
      // is gone — and that discard is reported, never swallowed.
      { field: "decisionMaker.name", reason: "contact-role-dropped", value: name.value, sourceUrl: TEAM, snippet: name.snippet },
    ]);
  });

  it("a ROLE the page never states sinks the contact, even on a genuine snippet", () => {
    // The R1 failure, aimed at the field where it does the most damage. The snippet is
    // verbatim; the title is invented. Before the value check this persisted a contact
    // titled "Chief Revenue Officer" over a sentence calling him a dermatologist.
    const invented = fact(CONTACT_SPAN, TEAM, "Chief Revenue Officer");
    const result = verifyFindings(
      findings({ decisionMaker: { name, role: invented, email: null, linkedinUrl: null } }),
      pages(),
    );

    expect(result.verified.decisionMaker).toBeNull();
    expect(result.dropped.map((d) => [d.field, d.reason])).toEqual([
      ["decisionMaker.role", "value-not-in-snippet"],
      ["decisionMaker.name", "contact-role-dropped"],
    ]);
  });

  it("a dropped NAME with a verifying role degrades to D9's role-only variant", () => {
    const result = verifyFindings(
      findings({ decisionMaker: { name: fact("Dr. Invented Person"), role, email: null, linkedinUrl: null } }),
      pages(),
    );

    expect(result.verified.decisionMaker).toEqual({ name: null, role, email: null, linkedinUrl: null });
    expect(result.dropped).toEqual([
      { field: "decisionMaker.name", reason: "snippet-not-verbatim", value: "Dr. Invented Person", sourceUrl: TEAM, snippet: "Dr. Invented Person" },
    ]);
  });

  it("a dropped email/linkedin degrades those fields alone", () => {
    const result = verifyFindings(
      findings({
        decisionMaker: {
          name,
          role,
          email: fact("joel@fabricated.example", TEAM, "joel@fabricated.example"),
          linkedinUrl: null,
        },
      }),
      pages(),
    );

    expect(result.verified.decisionMaker).toEqual({ name, role, email: null, linkedinUrl: null });
    expect(result.dropped.map((d) => d.field)).toEqual(["decisionMaker.email"]);
  });

  it("a fully verified contact survives untouched", () => {
    const dm = { name, role, email: null, linkedinUrl: null };
    const result = verifyFindings(findings({ decisionMaker: dm }), pages());
    expect(result.verified.decisionMaker).toEqual(dm);
    expect(result.dropped).toEqual([]);
  });
});

describe("verifyFindings — the shape it hands to the waterfall", () => {
  it("keeps only the verified members of each array, preserving order", () => {
    // `incumbentTooling` is a QUOTATION list, so each surviving value is a real span of
    // its own snippet. The middle one dies at the SNIPPET gate, before its value matters.
    const a = fact(VERBATIM_SPAN, TEAM, "dermatologist");
    const b = fact("This sentence is not on any page.", TEAM, "Zocdoc");
    const c = fact(CURLY_QUOTE_SPAN, TEAM, "commitment");

    const result = verifyFindings(findings({ incumbentTooling: [a, b, c] }), pages());
    expect(result.verified.incumbentTooling).toEqual([a, c]);
    expect(result.dropped).toEqual([
      { field: "incumbentTooling[1]", reason: "snippet-not-verbatim", value: "Zocdoc", sourceUrl: TEAM, snippet: b.snippet },
    ]);
  });

  it("drops unverifiable firmographics fields and keeps the rest", () => {
    const result = verifyFindings(
      findings({
        firmographics: {
          specialty: fact(VERBATIM_SPAN, TEAM, "dermatology"),
          website: fact("Invented tagline", TEAM, "schlessingermd.com"),
        },
      }),
      pages(),
    );

    expect(Object.keys(result.verified.firmographics)).toEqual(["specialty"]);
    expect(result.dropped.map((d) => d.field)).toEqual(["firmographics.website"]);
  });

  it("EVERY fact fabricated -> verified is empty and isEmptyFindings() reports true", () => {
    // This is the exact condition U7's escalation gate reads: extraction SUCCEEDED,
    // nothing threw, and we still learned nothing we can prove.
    const bogus = fact("Nothing on this page says this.");
    const result = verifyFindings(
      findings({
        firmographics: { specialty: bogus },
        ehr: bogus,
        incumbentTooling: [bogus],
        decisionMaker: { name: bogus, role: bogus, email: null, linkedinUrl: null },
        buyingMomentContext: [bogus],
      }),
      pages(),
    );

    expect(isEmptyFindings(result.verified)).toBe(true);
    expect(result.dropped.map((d) => d.field)).toEqual([
      "firmographics.specialty",
      "ehr",
      "incumbentTooling[0]",
      "decisionMaker.name",
      "decisionMaker.role",
      "buyingMomentContext[0]",
    ]);
  });

  it("empty findings verify to empty findings, with an empty page map", () => {
    const result = verifyFindings(findings(), new Map());
    expect(isEmptyFindings(result.verified)).toBe(true);
    expect(result.dropped).toEqual([]);
  });

  it("does not MUTATE the findings it was handed", () => {
    const input = findings({ ehr: fact("Not on the page") });
    verifyFindings(input, pages());
    expect(input.ehr).not.toBeNull();
  });

  it("every drop carries field path, reason, value and the offending snippet, for logging", () => {
    const result = verifyFindings(findings({ ehr: fact(STITCHED_PROVIDER_COUNT) }), pages());
    expect(result.dropped).not.toEqual([]);
    for (const drop of result.dropped) {
      expect(drop.field.length).toBeGreaterThan(0);
      expect([
        "url-not-held",
        "snippet-not-verbatim",
        "value-not-in-snippet",
        "contact-role-dropped",
      ]).toContain(drop.reason);
      // Without the value, a `value-not-in-snippet` drop cannot explain itself.
      expect(drop.value.length).toBeGreaterThan(0);
      expect(drop.snippet.length).toBeGreaterThan(0);
      expect(drop.sourceUrl).toMatch(/^https?:\/\//);
    }
  });
});
