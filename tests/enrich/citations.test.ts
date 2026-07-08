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

function fact(snippet: string, sourceUrl = TEAM, value = "value"): CitedFact {
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
      { field: "ehr", reason: "snippet-not-verbatim", sourceUrl: HOME, snippet: VERBATIM_SPAN },
    ]);
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
  const role = fact("Joel Schlessinger, MD", TEAM, "Founder");
  const name = fact("Joel Schlessinger, MD", TEAM, "Joel Schlessinger");

  it("a dropped ROLE collapses the whole contact to null — no role, no contact", () => {
    const result = verifyFindings(
      findings({ decisionMaker: { name, role: fact("Chief Fabrication Officer"), email: null, linkedinUrl: null } }),
      pages(),
    );

    expect(result.verified.decisionMaker).toBeNull();
    expect(result.dropped).toEqual([
      { field: "decisionMaker.role", reason: "snippet-not-verbatim", sourceUrl: TEAM, snippet: "Chief Fabrication Officer" },
      // The name VERIFIED. It is discarded anyway, because the contact it belonged to
      // is gone — and that discard is reported, never swallowed.
      { field: "decisionMaker.name", reason: "contact-role-dropped", sourceUrl: TEAM, snippet: name.snippet },
    ]);
  });

  it("a dropped NAME with a verifying role degrades to D9's role-only variant", () => {
    const result = verifyFindings(
      findings({ decisionMaker: { name: fact("Dr. Invented Person"), role, email: null, linkedinUrl: null } }),
      pages(),
    );

    expect(result.verified.decisionMaker).toEqual({ name: null, role, email: null, linkedinUrl: null });
    expect(result.dropped).toEqual([
      { field: "decisionMaker.name", reason: "snippet-not-verbatim", sourceUrl: TEAM, snippet: "Dr. Invented Person" },
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
    const a = fact(VERBATIM_SPAN, TEAM, "a");
    const b = fact("This sentence is not on any page.", TEAM, "b");
    const c = fact(CURLY_QUOTE_SPAN, TEAM, "c");

    const result = verifyFindings(findings({ incumbentTooling: [a, b, c] }), pages());
    expect(result.verified.incumbentTooling).toEqual([a, c]);
    expect(result.dropped).toEqual([
      { field: "incumbentTooling[1]", reason: "snippet-not-verbatim", sourceUrl: TEAM, snippet: b.snippet },
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

  it("every drop carries field path, reason and the offending snippet, for logging", () => {
    const result = verifyFindings(findings({ ehr: fact(STITCHED_PROVIDER_COUNT) }), pages());
    for (const drop of result.dropped) {
      expect(drop.field.length).toBeGreaterThan(0);
      expect(["url-not-held", "snippet-not-verbatim", "contact-role-dropped"]).toContain(drop.reason);
      expect(drop.snippet.length).toBeGreaterThan(0);
      expect(drop.sourceUrl).toMatch(/^https?:\/\//);
    }
  });
});
