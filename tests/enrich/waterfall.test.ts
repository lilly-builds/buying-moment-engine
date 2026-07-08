import { describe, expect, it } from "vitest";
import fullyResolved from "./fixtures/anthropic-research-fully-resolved.json";
import researchFixture from "./fixtures/anthropic-research-response.json";
import roleOnly from "./fixtures/anthropic-research-role-only.json";
import { parseMessagesResponse } from "@/src/enrich/anthropic-client";
import { parseResearchOutput } from "@/src/enrich/research-schema";
import {
  computeGaps,
  factsFromFindings,
  hasGap,
  normalizeLinkedinUrl,
  subtractFilled,
} from "@/src/enrich/gaps";
import type { ResearchFindings } from "@/src/enrich/types";

/**
 * Pure half of the waterfall: the cost guard and the fact flattener. No DB, no
 * mocks. `tests/enrich/integration.test.ts` drives the same logic through PGlite.
 */

function findingsFrom(fixture: unknown): ResearchFindings {
  const parsed = parseResearchOutput(parseMessagesResponse(fixture).text);
  if (!parsed.ok) throw new Error(`fixture failed to parse: ${parsed.reason}`);
  return parsed.findings;
}

describe("computeGaps — the cost guard, in pure form", () => {
  it("a Claude-resolved contact leaves NO gap (so PDL is never called)", () => {
    const gaps = computeGaps(findingsFrom(fullyResolved));
    expect(gaps).toEqual({ email: false, linkedinUrl: false });
    expect(hasGap(gaps)).toBe(false);
  });

  it("a named contact missing email + LinkedIn leaves both gaps", () => {
    const gaps = computeGaps(findingsFrom(researchFixture));
    expect(gaps).toEqual({ email: true, linkedinUrl: true });
    expect(hasGap(gaps)).toBe(true);
  });

  it("a role-only contact leaves no gap — PDL needs a NAME to look up", () => {
    const gaps = computeGaps(findingsFrom(roleOnly));
    expect(hasGap(gaps)).toBe(false);
  });

  it("no decision-maker at all leaves no gap", () => {
    const gaps = computeGaps({
      firmographics: {},
      ehr: null,
      incumbentTooling: [],
      decisionMaker: null,
      buyingMomentContext: [],
    });
    expect(hasGap(gaps)).toBe(false);
  });

  it("only the email gap when LinkedIn was cited", () => {
    const findings = findingsFrom(researchFixture);
    findings.decisionMaker!.linkedinUrl = {
      value: "https://linkedin.com/in/dana",
      sourceUrl: "https://sunshinederm.example/team",
      snippet: "Connect on LinkedIn",
    };
    expect(computeGaps(findings)).toEqual({ email: true, linkedinUrl: false });
  });
});

describe("subtractFilled — the DB closes gaps too, so a re-run does not re-spend", () => {
  const BOTH_GAPS = { email: true, linkedinUrl: true };

  it("clears a gap the stored contact already fills", () => {
    expect(
      subtractFilled(BOTH_GAPS, {
        email: "dana@sunshinederm.example",
        linkedinUrl: null,
      }),
    ).toEqual({ email: false, linkedinUrl: true });
  });

  it("a fully-filled stored contact leaves NO gap — PDL is never called again", () => {
    const gaps = subtractFilled(BOTH_GAPS, {
      email: "dana@sunshinederm.example",
      linkedinUrl: "https://linkedin.com/in/dana",
    });
    expect(hasGap(gaps)).toBe(false);
  });

  it("no stored contact yet -> the gaps stand untouched", () => {
    expect(subtractFilled(BOTH_GAPS, null)).toEqual(BOTH_GAPS);
  });

  it("an empty stored contact fills nothing", () => {
    expect(
      subtractFilled(BOTH_GAPS, { email: null, linkedinUrl: null }),
    ).toEqual(BOTH_GAPS);
  });

  it("never OPENS a gap Claude already closed", () => {
    expect(
      subtractFilled({ email: false, linkedinUrl: false }, {
        email: null,
        linkedinUrl: null,
      }),
    ).toEqual({ email: false, linkedinUrl: false });
  });
});

describe("normalizeLinkedinUrl — a scheme-less URL is a dead link in U9", () => {
  it("prefixes https:// when PDL omits the scheme", () => {
    expect(normalizeLinkedinUrl("linkedin.com/in/dana-whitfield")).toBe(
      "https://linkedin.com/in/dana-whitfield",
    );
  });

  it("leaves an https:// URL untouched", () => {
    expect(normalizeLinkedinUrl("https://linkedin.com/in/dana")).toBe(
      "https://linkedin.com/in/dana",
    );
  });

  it("leaves an http:// URL untouched — we do not silently rewrite the scheme", () => {
    expect(normalizeLinkedinUrl("http://linkedin.com/in/dana")).toBe(
      "http://linkedin.com/in/dana",
    );
  });

  it("is case-insensitive about the scheme", () => {
    expect(normalizeLinkedinUrl("HTTPS://linkedin.com/in/dana")).toBe(
      "HTTPS://linkedin.com/in/dana",
    );
  });

  it("absent / blank stays null — never the string 'https://'", () => {
    expect(normalizeLinkedinUrl(null)).toBeNull();
    expect(normalizeLinkedinUrl(undefined)).toBeNull();
    expect(normalizeLinkedinUrl("")).toBeNull();
    expect(normalizeLinkedinUrl("   ")).toBeNull();
  });
});

describe("factsFromFindings — what lands in practice_facts", () => {
  it("flattens firmographics, EHR, tooling and buying-moment context", () => {
    const facts = factsFromFindings(findingsFrom(researchFixture));
    const fields = facts.map((f) => f.field).sort();
    // KTD-4: `locationsCount` used to be here. A tally has no contiguous sentence
    // that proves it, so the model no longer reports one and code counts it instead.
    expect(fields).toEqual([
      "buying_moment_1",
      "ehr",
      "incumbent_tooling_1",
      "specialty",
      "website",
    ]);
    // Every persisted fact carries its citation — the DB FK depends on it.
    for (const fact of facts) {
      expect(fact.sourceUrl).toMatch(/^https?:\/\//);
      expect(fact.snippet.length).toBeGreaterThan(0);
    }
  });

  it("EDGE CASE: empty findings flatten to zero facts", () => {
    expect(
      factsFromFindings({
        firmographics: {},
        ehr: null,
        incumbentTooling: [],
        decisionMaker: null,
        buyingMomentContext: [],
      }),
    ).toEqual([]);
  });
});
