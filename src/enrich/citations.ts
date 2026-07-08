import type {
  CitedFact,
  DecisionMaker,
  Firmographics,
  ResearchFindings,
} from "./types";

/**
 * The unit this whole refactor exists for.
 *
 * D2/R5 says "the brief never states an uncited fact." Until now that was enforced
 * by a schema that checked a fact HAS a `sourceUrl` and a `snippet` — never that the
 * snippet is actually on that page. It could not be: the agentic mechanism let Claude
 * browse, and we never held the bytes it read. A stitched-together snippet with a real
 * URL was indistinguishable from a quotation.
 *
 * Scrape-then-extract hands us the page text keyed by absolute URL, so the check
 * becomes arithmetic: `normalize(pageWeHold[sourceUrl]).includes(normalize(snippet))`.
 * It caught real fabrication on the first run (E7) — see the fixture.
 *
 * Pure: no network, no DB, no clock. Mirrors `gaps.ts`.
 *
 * ─── The two rules that keep this honest ──────────────────────────────────────
 *
 * 1. NORMALIZE BOTH SIDES, IDENTICALLY. Any transform applied to the snippet and not
 *    to the page (or vice versa) turns a true fact into a "fabrication". `html-clean.ts`
 *    is bound by the same rule from the other end: it may drop nodes and collapse
 *    spacing, never rewrite a word.
 *
 * 2. RETURN THE DROPS. A fact removed silently is a fact we cannot explain. Every drop
 *    carries its field path, its reason, and the offending snippet, because the drop
 *    COUNT is the early-warning signal that a prompt has drifted, and the drop LIST is
 *    what turns "the model hallucinated" into a diff you can read.
 */

/** Straight-quote both curly single quotes; likewise double. */
const CURLY_SINGLE = /[‘’]/g;
const CURLY_DOUBLE = /[“”]/g;
/** En-dash and em-dash only. See `normalizeForCitation`. */
const DASHES = /[–—]/g;
const WHITESPACE_RUN = /\s+/g;
/** Trailing `/` — a URL-identity artifact, not a claim. See `lookupPage`. */
const TRAILING_SLASH = /\/$/;

export type DropReason =
  /** The model cited a URL that is not a key in the page map. It invented a source. */
  | "url-not-held"
  /** The cited page does not contain the snippet, contiguously, after normalization. */
  | "snippet-not-verbatim"
  /**
   * The fact itself verified, but the `decisionMaker` it hung on was discarded because
   * that contact's ROLE could not be verified. Not a model failure — reported anyway,
   * because a verified fact vanishing from the output with no record is exactly the
   * kind of silence this file exists to abolish.
   */
  | "contact-role-dropped";

export interface DroppedFact {
  /** e.g. `firmographics.specialty`, `incumbentTooling[1]`, `decisionMaker.role`. */
  field: string;
  reason: DropReason;
  sourceUrl: string;
  snippet: string;
}

export interface VerificationResult {
  verified: ResearchFindings;
  dropped: DroppedFact[];
}

/**
 * Ported verbatim from the E7 harness — these five transforms are the ones the
 * 9/10-and-8/9 verification rates were measured against.
 *
 * Deliberately NARROW. It would be easy to also fold `‚ „ ‹ › ′ ″ ‒ ―` and zero-width
 * characters, and each addition can only ever make the check MORE permissive — i.e.
 * let a fabrication through. Every widening is an untested loosening of the one
 * guarantee this module sells. Loosen on measured evidence (a true fact dropped in a
 * real run, named in `dropped`), never on a hunch. The strictness is the feature.
 */
export function normalizeForCitation(text: string): string {
  return text
    .toLowerCase()
    .replace(CURLY_SINGLE, "'")
    .replace(CURLY_DOUBLE, '"')
    .replace(DASHES, "-")
    .replace(WHITESPACE_RUN, " ")
    .trim();
}

/**
 * `https://x/team` and `https://x/team/` name the same page we handed the model, and
 * which one it echoes back is a coin flip. Tolerating the slash is not evidence
 * loosening: the URL is an IDENTIFIER we supplied, while the snippet is the CLAIM.
 * Ported from the E7 harness, which measured 0 bad URLs across 19 facts with exactly
 * this rule. Nothing else about the URL is forgiven — a different path or host is
 * `url-not-held`.
 */
function lookupPage(
  normalizedPages: Map<string, string>,
  sourceUrl: string,
): string | undefined {
  const direct = normalizedPages.get(sourceUrl);
  if (direct !== undefined) return direct;
  return (
    normalizedPages.get(sourceUrl.replace(TRAILING_SLASH, "")) ??
    normalizedPages.get(`${sourceUrl}/`)
  );
}

/** A verified fact is returned as-is; an unverifiable one is pushed onto `dropped`. */
function verifyFact(
  field: string,
  fact: CitedFact,
  normalizedPages: Map<string, string>,
  dropped: DroppedFact[],
): CitedFact | null {
  const drop = (reason: DropReason): null => {
    dropped.push({ field, reason, sourceUrl: fact.sourceUrl, snippet: fact.snippet });
    return null;
  };

  const page = lookupPage(normalizedPages, fact.sourceUrl);
  if (page === undefined) return drop("url-not-held");

  const snippet = normalizeForCitation(fact.snippet);
  // `"anything".includes("")` is true, so a snippet of pure whitespace would sail
  // through and prove nothing. Zod's `min(1)` accepts `"   "`; this does not.
  if (snippet === "") return drop("snippet-not-verbatim");

  return page.includes(snippet) ? fact : drop("snippet-not-verbatim");
}

/** Fixed and ordered, so `dropped` reads the same on every run (KTD-4). */
const FIRMOGRAPHIC_FIELDS = ["specialty", "website", "yearFounded"] as const;

function verifyFirmographics(
  firmographics: Firmographics,
  normalizedPages: Map<string, string>,
  dropped: DroppedFact[],
): Firmographics {
  const verified: Firmographics = {};
  for (const field of FIRMOGRAPHIC_FIELDS) {
    const fact = firmographics[field];
    if (fact === undefined) continue;
    const ok = verifyFact(`firmographics.${field}`, fact, normalizedPages, dropped);
    if (ok) verified[field] = ok;
  }
  return verified;
}

/**
 * The contact degrades along D9's ladder rather than failing:
 *   role verified + name verified  -> named contact
 *   role verified + name dropped   -> the role-only variant (honest, still useful)
 *   role dropped                   -> null. A contact whose role we cannot prove is
 *                                     not a contact; who to reach out to is the one
 *                                     thing the brief must not guess.
 */
function verifyDecisionMaker(
  decisionMaker: DecisionMaker | null,
  normalizedPages: Map<string, string>,
  dropped: DroppedFact[],
): DecisionMaker | null {
  if (!decisionMaker) return null;
  const { name, role, email, linkedinUrl } = decisionMaker;

  // Check every field first — even when the role is about to sink the contact — so a
  // genuinely fabricated `name` is reported as fabrication rather than as collateral.
  const okName = name ? verifyFact("decisionMaker.name", name, normalizedPages, dropped) : null;
  const okRole = verifyFact("decisionMaker.role", role, normalizedPages, dropped);
  const okEmail = email ? verifyFact("decisionMaker.email", email, normalizedPages, dropped) : null;
  const okLinkedin = linkedinUrl
    ? verifyFact("decisionMaker.linkedinUrl", linkedinUrl, normalizedPages, dropped)
    : null;

  if (!okRole) {
    // Report the survivors we are throwing away with the contact. Rule 2.
    for (const [field, fact] of [
      ["decisionMaker.name", okName],
      ["decisionMaker.email", okEmail],
      ["decisionMaker.linkedinUrl", okLinkedin],
    ] as const) {
      if (fact) {
        dropped.push({
          field,
          reason: "contact-role-dropped",
          sourceUrl: fact.sourceUrl,
          snippet: fact.snippet,
        });
      }
    }
    return null;
  }

  return { name: okName, role: okRole, email: okEmail, linkedinUrl: okLinkedin };
}

function verifyList(
  field: string,
  facts: CitedFact[],
  normalizedPages: Map<string, string>,
  dropped: DroppedFact[],
): CitedFact[] {
  return facts.filter(
    (fact, i) => verifyFact(`${field}[${i}]`, fact, normalizedPages, dropped) !== null,
  );
}

/**
 * Drop every fact we cannot prove against the pages we hold, and say which and why.
 *
 * `pages` is `Map<absoluteUrl, cleanedText>` exactly as `scrape.ts` produced it — the
 * same bytes the extractor was shown. Never a flattened blob (KTD-3): without the URL
 * key there is no provenance to check, only existence somewhere.
 *
 * Non-mutating. `verified` is a fresh object; the caller keeps the original findings
 * for logging alongside the drops.
 *
 * The agentic escalation path (U7) passes through here too. Where we hold no pages for
 * it, every fact is `url-not-held` — which is the truth: we cannot verify what we never
 * fetched. See the Risks section of the mechanism plan.
 */
export function verifyFindings(
  findings: ResearchFindings,
  pages: Map<string, string>,
): VerificationResult {
  // Normalize each page ONCE. A practice with 7 pages × 12 facts would otherwise
  // re-normalize ~50KB of text 84 times.
  const normalizedPages = new Map(
    [...pages].map(([url, text]) => [url, normalizeForCitation(text)] as const),
  );
  const dropped: DroppedFact[] = [];

  const verified: ResearchFindings = {
    firmographics: verifyFirmographics(findings.firmographics, normalizedPages, dropped),
    ehr: findings.ehr
      ? verifyFact("ehr", findings.ehr, normalizedPages, dropped)
      : null,
    incumbentTooling: verifyList("incumbentTooling", findings.incumbentTooling, normalizedPages, dropped),
    decisionMaker: verifyDecisionMaker(findings.decisionMaker, normalizedPages, dropped),
    buyingMomentContext: verifyList("buyingMomentContext", findings.buyingMomentContext, normalizedPages, dropped),
  };

  return { verified, dropped };
}
