import { describe, expect, it } from "vitest";
import fullyResolved from "./fixtures/anthropic-research-fully-resolved.json";
import researchFixture from "./fixtures/anthropic-research-response.json";
import roleOnly from "./fixtures/anthropic-research-role-only.json";
import { parseMessagesResponse } from "@/src/enrich/anthropic-client";
import { parseResearchOutput } from "@/src/enrich/research-schema";
import { computeGaps, factsFromFindings, hasGap } from "@/src/enrich/gaps";
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

describe("factsFromFindings — what lands in practice_facts", () => {
  it("flattens firmographics, EHR, tooling and buying-moment context", () => {
    const facts = factsFromFindings(findingsFrom(researchFixture));
    const fields = facts.map((f) => f.field).sort();
    expect(fields).toEqual([
      "buying_moment_1",
      "ehr",
      "incumbent_tooling_1",
      "locationsCount",
      "specialty",
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
