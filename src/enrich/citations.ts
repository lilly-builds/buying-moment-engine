import {
  FIRMOGRAPHIC_FIELDS,
  type CitedFact,
  type DecisionMaker,
  type Firmographics,
  type ResearchFindings,
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
  /**
   * Facts KEPT without proof. Only ever non-empty on the agentic escalation path, and
   * only for URLs we never fetched. Empty on the primary path, always.
   */
  unverifiable: DroppedFact[];
}

export interface VerifyOptions {
  /**
   * What to do with a fact citing a URL absent from `pages`.
   *
   * `"drop"` — the DEFAULT, and the only correct answer on the primary path. We handed
   * the model every URL it was allowed to cite; inventing one is fabrication.
   *
   * `"keep-unverifiable"` — for the agentic escalation path ALONE. That path browses the
   * open web, so it legitimately cites pages we never fetched. We cannot call those facts
   * false; we simply cannot prove them, which is precisely the assurance level this whole
   * refactor exists to escape. They are kept, counted, and reported.
   *
   * A `snippet-not-verbatim` failure on a page we DO hold is dropped under both modes.
   * Where we can check, the agentic path gets no exemption.
   */
  unheldUrl?: "drop" | "keep-unverifiable";
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
 * Everything the verification pass needs, in one object, so a new call site cannot
 * silently forget to honour `keepUnheld`.
 */
interface VerifyContext {
  /** Pre-normalized ONCE. 7 pages x 12 facts would otherwise re-normalize ~50KB 84 times. */
  pages: Map<string, string>;
  dropped: DroppedFact[];
  unverifiable: DroppedFact[];
  keepUnheld: boolean;
}

/**
 * `https://x/team` and `https://x/team/` name the same page we handed the model, and
 * which one it echoes back is a coin flip. Tolerating the slash is not evidence
 * loosening: the URL is an IDENTIFIER we supplied, while the snippet is the CLAIM.
 * Ported from the E7 harness, which measured 0 bad URLs across 19 facts with exactly
 * this rule. Nothing else about the URL is forgiven — a different path or host is
 * `url-not-held`.
 */
function lookupPage(pages: Map<string, string>, sourceUrl: string): string | undefined {
  const direct = pages.get(sourceUrl);
  if (direct !== undefined) return direct;
  return pages.get(sourceUrl.replace(TRAILING_SLASH, "")) ?? pages.get(`${sourceUrl}/`);
}

function factRef(field: string, fact: CitedFact, reason: DropReason): DroppedFact {
  return { field, reason, sourceUrl: fact.sourceUrl, snippet: fact.snippet };
}

/** Verified -> the fact. Unprovable -> `null`, and a row on `dropped` saying why. */
function verifyFact(field: string, fact: CitedFact, ctx: VerifyContext): CitedFact | null {
  const page = lookupPage(ctx.pages, fact.sourceUrl);
  if (page === undefined) {
    // The agentic path cites the open web. We cannot check it; we also cannot call it
    // a lie. Keep it, and say out loud that it is unproven.
    if (ctx.keepUnheld) {
      ctx.unverifiable.push(factRef(field, fact, "url-not-held"));
      return fact;
    }
    ctx.dropped.push(factRef(field, fact, "url-not-held"));
    return null;
  }

  const snippet = normalizeForCitation(fact.snippet);
  // `"anything".includes("")` is true, so a snippet of pure whitespace would sail
  // through and prove nothing. Zod's `min(1)` accepts `"   "`; this does not.
  if (snippet !== "" && page.includes(snippet)) return fact;

  // We HOLD this page and the snippet is not on it. No mode forgives that.
  ctx.dropped.push(factRef(field, fact, "snippet-not-verbatim"));
  return null;
}

function verifyFirmographics(firmographics: Firmographics, ctx: VerifyContext): Firmographics {
  const verified: Firmographics = {};
  for (const field of FIRMOGRAPHIC_FIELDS) {
    const fact = firmographics[field];
    if (fact === undefined) continue;
    const ok = verifyFact(`firmographics.${field}`, fact, ctx);
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
  ctx: VerifyContext,
): DecisionMaker | null {
  if (!decisionMaker) return null;
  const { name, role, email, linkedinUrl } = decisionMaker;

  // Check every field first — even when the role is about to sink the contact — so a
  // genuinely fabricated `name` is reported as fabrication rather than as collateral.
  const okName = name ? verifyFact("decisionMaker.name", name, ctx) : null;
  const okRole = verifyFact("decisionMaker.role", role, ctx);
  const okEmail = email ? verifyFact("decisionMaker.email", email, ctx) : null;
  const okLinkedin = linkedinUrl
    ? verifyFact("decisionMaker.linkedinUrl", linkedinUrl, ctx)
    : null;

  if (!okRole) {
    // Report the survivors we are throwing away with the contact. Rule 2.
    for (const [field, fact] of [
      ["decisionMaker.name", okName],
      ["decisionMaker.email", okEmail],
      ["decisionMaker.linkedinUrl", okLinkedin],
    ] as const) {
      if (fact) ctx.dropped.push(factRef(field, fact, "contact-role-dropped"));
    }
    return null;
  }

  return { name: okName, role: okRole, email: okEmail, linkedinUrl: okLinkedin };
}

function verifyList(field: string, facts: CitedFact[], ctx: VerifyContext): CitedFact[] {
  return facts.filter((fact, i) => verifyFact(`${field}[${i}]`, fact, ctx) !== null);
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
 * The agentic escalation path passes through here too, with
 * `{ unheldUrl: "keep-unverifiable" }`. It browses the open web, so most of its citations
 * name pages we never fetched. Those are kept and COUNTED, not proven — the pre-refactor
 * assurance level, which is what a rare fallback should cost. What it does not get is an
 * exemption on pages we DO hold: a snippet that is not on one of those is dropped,
 * whichever model produced it.
 */
export function verifyFindings(
  findings: ResearchFindings,
  pages: Map<string, string>,
  options: VerifyOptions = {},
): VerificationResult {
  const ctx: VerifyContext = {
    pages: new Map(
      [...pages].map(([url, text]) => [url, normalizeForCitation(text)] as const),
    ),
    dropped: [],
    unverifiable: [],
    keepUnheld: options.unheldUrl === "keep-unverifiable",
  };

  const verified: ResearchFindings = {
    firmographics: verifyFirmographics(findings.firmographics, ctx),
    ehr: findings.ehr ? verifyFact("ehr", findings.ehr, ctx) : null,
    incumbentTooling: verifyList("incumbentTooling", findings.incumbentTooling, ctx),
    decisionMaker: verifyDecisionMaker(findings.decisionMaker, ctx),
    buyingMomentContext: verifyList("buyingMomentContext", findings.buyingMomentContext, ctx),
  };

  return { verified, dropped: ctx.dropped, unverifiable: ctx.unverifiable };
}
