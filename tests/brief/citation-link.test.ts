import { describe, expect, it } from "vitest";
import {
  RANGE_TERM_MAX_CHARS,
  TEXT_FRAGMENT_MAX_EXACT,
  citationHref,
  facebookHref,
  linkedinHref,
} from "@/src/brief/citation-link";

/**
 * Lilly's directive #1 — "clickable sources that go as directly as possible to where that
 * information came from" — stops being a sentence in a spec here and becomes an assertion.
 * Pure: no network, no DB, no mocks.
 *
 * Two habits run through this file:
 *
 * 1. **Assert the DECODED value, never `toContain("text=")`.** A directive that contains
 *    `text=` and the wrong characters is exactly the bug: the browser fails to match, the
 *    link silently degrades to the top of the page, and nothing goes red. The only way to
 *    know a fragment is right is to decode it and compare it to the sentence it must find.
 *
 * 2. **Pin the platform claims the module rests on.** `encodeTextFragmentTerm` exists solely
 *    because `encodeURIComponent` does not escape `-`. If that ever changed, the module's
 *    hand-rolled replace would be the confusing part, not the bug — so the claim is a test.
 */

const TEAM = "https://www.schlessingermd.com/about/team";
const TEXT_MARKER = ":~:text=";

/** Everything after `:~:text=`. The lookup is itself the assertion that a directive exists. */
function directiveOf(href: string): string {
  const i = href.indexOf(TEXT_MARKER);
  expect(i, `expected a text directive in ${href}`).toBeGreaterThan(-1);
  return href.slice(i + TEXT_MARKER.length);
}

/** The module's whitespace rule, restated so a test never depends on the code under test. */
const collapse = (text: string) => text.replace(/\s+/g, " ").trim();

/**
 * >300 characters, and deliberately loaded: the first 40 characters carry a comma, an ASCII
 * hyphen and an em-dash; the last 40 carry a comma and an ampersand. Both range terms
 * therefore exercise every escape the directive grammar reserves.
 */
const LONG_SNIPPET =
  "Omaha, Nebraska — board-certified dermatology, Mohs surgery and cosmetic care " +
  "have been offered at Schlessinger MD since 1993, from a single practice on West " +
  "Dodge Road where five providers see patients across two clinical suites and an " +
  "on-site surgical facility built for reconstruction of the head, neck & scalp.";

describe("the platform claims this module is built on", () => {
  it("encodeURIComponent escapes `,` and `&` — and leaves `-` raw", () => {
    // The entire reason `encodeTextFragmentTerm` does not just call encodeURIComponent.
    // `-` is RFC 3986 *unreserved*; the text-fragment grammar layered on top reserves it
    // as the prefix/suffix marker, and the URL spec has no opinion about that.
    expect(encodeURIComponent(",")).toBe("%2C");
    expect(encodeURIComponent("&")).toBe("%26");
    expect(encodeURIComponent("-")).toBe("-");
  });

  it("encodeURIComponent THROWS on a lone surrogate (the positive control for `toWellFormed`)", () => {
    // If this ever stops throwing, `percentEncode`'s repair step is dead weight and the
    // comment justifying it is a lie. It is the only input that can break `citationHref`'s
    // never-throws contract.
    expect(() => encodeURIComponent("\uD800")).toThrow(URIError);
  });

  it("the range form can never overlap: MAX_EXACT leaves room for two whole terms", () => {
    // `textDirective`'s non-overlap guard is unreachable while this holds. It is checked in
    // code anyway, because both constants are tunable and the failure would be silent —
    // a `text=a,b` whose `b` starts before `a` ends selects the wrong span, not nothing.
    expect(TEXT_FRAGMENT_MAX_EXACT).toBeGreaterThan(2 * RANGE_TERM_MAX_CHARS);
  });
});

describe("citationHref — when there is nothing deeper than the page", () => {
  it("returns the bare URL when no snippet is supplied", () => {
    expect(citationHref(TEAM)).toBe(TEAM);
    expect(citationHref(TEAM, null)).toBe(TEAM);
    expect(citationHref(TEAM, undefined)).toBe(TEAM);
    expect(citationHref(TEAM, "")).toBe(TEAM);
  });

  it("returns the bare URL for a whitespace-only snippet, never an empty directive", () => {
    // Zod's `min(1)` accepts `"   "` — the same hole `verifyFact` closes one layer up.
    // `#:~:text=` with nothing after it is a malformed URL, not a shallower link.
    expect(citationHref(TEAM, "   \n\t  ")).toBe(TEAM);
  });

  it("returns a malformed URL unchanged, and does not throw", () => {
    expect(() => citationHref("not a url", "a real snippet")).not.toThrow();
    expect(citationHref("not a url", "a real snippet")).toBe("not a url");
    expect(citationHref("", "a real snippet")).toBe("");
    expect(citationHref("/relative/path", "a real snippet")).toBe("/relative/path");
  });

  it("returns a non-http(s) source unchanged — a text fragment on a mailto is nonsense (P3-9)", () => {
    // `URL.canParse` accepts these; a scroll-to-text directive on them does not resolve to a
    // page. Degrade to the given string rather than emit a link U9 would render as broken.
    expect(citationHref("mailto:joel@clinic.example", "a real snippet")).toBe("mailto:joel@clinic.example");
    expect(citationHref("tel:+15551234567", "a real snippet")).toBe("tel:+15551234567");
    expect(citationHref("ftp://files.example/report.pdf", "a real snippet")).toBe(
      "ftp://files.example/report.pdf",
    );
  });

  it("refuses to double-apply: a fragment that already holds `:~:` is returned unchanged", () => {
    // We did not write that directive and we do not own it. Appending a second `:~:`
    // produces a fragment no browser honours.
    const owned = `${TEAM}#:~:text=someone%20else`;
    expect(citationHref(owned, "our snippet")).toBe(owned);
    expect(citationHref(`${TEAM}#team:~:text=x`, "our snippet")).toBe(`${TEAM}#team:~:text=x`);
  });

  it("looks for `:~:` in the FRAGMENT, not anywhere in the URL", () => {
    // A path may legally contain `:~:`. Testing `sourceUrl.includes(":~:")` would refuse to
    // deep-link a page for a substring of its own path.
    const odd = "https://example.com/a:~:b";
    expect(citationHref(odd, "Hello")).toBe(`${odd}#:~:text=Hello`);
  });
});

describe("citationHref — the text directive", () => {
  it("appends a fragment whose decoded directive IS the collapsed snippet", () => {
    const href = citationHref(TEAM, "Dr. Ann Lee\n  is board-certified.\t");
    expect(href).toBe(`${TEAM}#:~:text=Dr.%20Ann%20Lee%20is%20board%2Dcertified.`);
    expect(decodeURIComponent(directiveOf(href))).toBe("Dr. Ann Lee is board-certified.");
  });

  it("percent-encodes every character the directive grammar reserves: `-`, `,`, `&`", () => {
    // `&` ends a directive, `,` separates terms, `-` marks prefix/suffix. A raw one of any
    // of the three turns the sentence into syntax, and the browser matches nothing.
    const snippet = "Cats, dogs & co-ops";
    const directive = directiveOf(citationHref(TEAM, snippet));

    expect(directive).toBe("Cats%2C%20dogs%20%26%20co%2Dops");
    expect(directive).not.toMatch(/[-,&]/);
    expect(decodeURIComponent(directive)).toBe(snippet);
  });

  it("escapes the hyphen AFTER encoding, so an existing percent-escape is never corrupted", () => {
    // A percent-escape is `%` + two hex digits, and no hex digit is `-`. Every hyphen left
    // in the encoded string is a literal one from the input — which is what makes the
    // blanket `.replace(/-/g, "%2D")` safe rather than reckless.
    const snippet = "50% off - today";
    const directive = directiveOf(citationHref(TEAM, snippet));

    expect(directive).toBe("50%25%20off%20%2D%20today");
    expect(decodeURIComponent(directive)).toBe(snippet);
  });

  it("collapses newlines, tabs and doubled spaces before encoding", () => {
    // Browsers match against RENDERED text, in which a newline between two words is one
    // space. Our snippets come out of cleaned HTML and carry the source's line breaks.
    const href = citationHref(TEAM, "  Consistently   voted\n\nthe best\tdermatologist  ");
    expect(decodeURIComponent(directiveOf(href))).toBe("Consistently voted the best dermatologist");
    expect(directiveOf(href)).not.toContain("%0A");
  });

  it("does NOT lowercase, and does NOT fold curly quotes or em-dashes", () => {
    // The deliberate divergence from `normalizeForCitation`. That function transforms both
    // sides of a comparison it owns; this one is compared against the page's real characters
    // by the browser, which does its own case-insensitive matching. Fold `’` to `'` and the
    // fragment stops matching a page that genuinely says `’`.
    const snippet = "Dr. O’Neil — MOHS surgeon";
    const directive = directiveOf(citationHref(TEAM, snippet));

    expect(decodeURIComponent(directive)).toBe(snippet);
    expect(directive).toContain("%E2%80%99"); // ’ survived as ’
    expect(directive).toContain("%E2%80%94"); // — survived as —, not folded to %2D
    expect(directive).toContain("MOHS");
  });

  it("preserves an existing element-id fragment: `#team` becomes `#team:~:text=`", () => {
    const href = citationHref(`${TEAM}#team`, "Our providers");
    expect(href).toBe(`${TEAM}#team:~:text=Our%20providers`);
  });

  it("treats a trailing bare `#` as an already-open fragment", () => {
    expect(citationHref(`${TEAM}#`, "Our providers")).toBe(`${TEAM}#:~:text=Our%20providers`);
  });

  it("never rewrites the sourceUrl — the href must name the page citations.ts verified", () => {
    // `new URL(x).toString()` lowercases the host and adds a trailing slash to a bare origin.
    // `sourceUrl` is the exact identifier stored on the evidence row; string surgery only.
    const raw = "https://Example.COM/Team?q=A%20B";
    expect(citationHref(raw, "Hello")).toBe(`${raw}#:~:text=Hello`);
    expect(citationHref("https://example.com", "Hello")).toBe("https://example.com#:~:text=Hello");
  });
});

describe("citationHref — a long snippet degrades to a `start,end` range", () => {
  const collapsed = collapse(LONG_SNIPPET);
  const href = citationHref(TEAM, LONG_SNIPPET);
  const directive = directiveOf(href);

  it("the fixture is actually long enough to trigger the range form", () => {
    expect(collapsed.length).toBeGreaterThan(TEXT_FRAGMENT_MAX_EXACT);
  });

  it("emits exactly one literal comma — the separator — with each half encoded alone", () => {
    // Both halves contain commas of their own. If they were not escaped to `%2C` the
    // browser would read four terms and match nothing.
    expect(directive.split(",")).toHaveLength(2);
    expect(directive).toBe(
      "Omaha%2C%20Nebraska%20%E2%80%94%20board%2Dcertified,of%20the%20head%2C%20neck%20%26%20scalp.",
    );
  });

  it("both halves decode to real, whole-word substrings of the collapsed snippet", () => {
    const [start, end] = directive.split(",").map(decodeURIComponent);

    expect(start).toBe("Omaha, Nebraska — board-certified");
    expect(end).toBe("of the head, neck & scalp.");

    // Exact substrings — not paraphrases, not re-cased. This is the same contract
    // `citations.ts` enforces on the snippet itself, one layer down.
    expect(collapsed).toContain(start);
    expect(collapsed).toContain(end);
    expect(collapsed.startsWith(start)).toBe(true);
    expect(collapsed.endsWith(end)).toBe(true);
  });

  it("start precedes end, and the two never overlap", () => {
    const [start, end] = directive.split(",").map(decodeURIComponent);
    const startEndsAt = start.length;
    const endBeginsAt = collapsed.length - end.length;

    expect(startEndsAt).toBeLessThan(endBeginsAt);
    expect(collapsed.indexOf(start)).toBeLessThan(collapsed.lastIndexOf(end));
  });

  it("each half is capped and lands on a word boundary — a half-word term matches nothing", () => {
    const [start, end] = directive.split(",").map(decodeURIComponent);

    expect(start.length).toBeLessThanOrEqual(RANGE_TERM_MAX_CHARS);
    expect(end.length).toBeLessThanOrEqual(RANGE_TERM_MAX_CHARS);
    // The browser anchors each term at a word boundary: `board-certi` will not match
    // `board-certified`. So the character just outside each term must be a space.
    expect(collapsed[start.length]).toBe(" ");
    expect(collapsed[collapsed.length - end.length - 1]).toBe(" ");
  });

  it("a snippet at or under the cap is still quoted whole", () => {
    const short = "a".repeat(TEXT_FRAGMENT_MAX_EXACT);
    const d = directiveOf(citationHref(TEAM, short));
    expect(d.split(",")).toHaveLength(1);
    expect(decodeURIComponent(d)).toBe(short);
  });
});

describe("citationHref — when no safe range pair exists, it falls back to the exact form", () => {
  const exactDirective = (snippet: string) => {
    const d = directiveOf(citationHref(TEAM, snippet));
    // One term, no separator: this is the exact form, not a range.
    expect(d.split(",")).toHaveLength(1);
    return decodeURIComponent(d);
  };

  it("falls back when the first 40 characters hold no word boundary", () => {
    const snippet = `${"x".repeat(50)} ${LONG_SNIPPET}`;
    const collapsed = collapse(snippet);
    const decoded = exactDirective(snippet);

    expect(decoded.length).toBeGreaterThan(0);
    expect(decoded.length).toBeLessThanOrEqual(TEXT_FRAGMENT_MAX_EXACT);
    expect(collapsed.startsWith(decoded)).toBe(true);
    expect(collapsed[decoded.length]).toBe(" "); // still cut on a word boundary
  });

  it("falls back when the last 40 characters hold no word boundary", () => {
    const snippet = `${LONG_SNIPPET} ${"y".repeat(50)}`;
    const collapsed = collapse(snippet);
    const decoded = exactDirective(snippet);

    expect(decoded.length).toBeGreaterThan(0);
    expect(collapsed.startsWith(decoded)).toBe(true);
  });

  it("a long UNBROKEN token still yields a valid, non-empty directive", () => {
    // No boundary anywhere, so the word-boundary cut returns nothing and the fixed-width
    // slice takes over. It will not match (the browser needs a boundary) and that is the
    // point: an unmatchable directive lands the reader on the right page; an EMPTY one
    // (`#:~:text=`) is a malformed URL.
    const decoded = exactDirective("x".repeat(400));
    expect(decoded).toBe("x".repeat(TEXT_FRAGMENT_MAX_EXACT));
  });

  it("never throws when the fixed-width cut splits a surrogate pair", () => {
    // The one place this module can MANUFACTURE the input `encodeURIComponent` rejects:
    // 401 UTF-16 units of unbroken emoji, sliced at 300, ends on a lone high surrogate.
    const emoji = `a${"\u{1F642}".repeat(200)}`;
    expect(() => encodeURIComponent(emoji.slice(0, 300))).toThrow(URIError); // positive control

    const href = citationHref(TEAM, emoji);
    expect(href.startsWith(`${TEAM}#:~:text=`)).toBe(true);
    expect(directiveOf(href).length).toBeGreaterThan(0);
    expect(directiveOf(href)).toContain("%EF%BF%BD"); // the broken half, repaired to U+FFFD
  });

  it("never throws on a lone surrogate already present in the snippet", () => {
    const href = citationHref(TEAM, "board\uD800certified");
    expect(href).toBe(`${TEAM}#:~:text=board%EF%BF%BDcertified`);
  });
});

describe("linkedinHref — the contact's profile, or the search that finds it", () => {
  it("returns a stored profile URL verbatim — U5 already guaranteed the scheme", () => {
    // `normalizeLinkedinUrl` (src/enrich/gaps.ts) prefixed `https://` at the persist
    // boundary. Re-normalizing here would be a second rule enforcing one invariant.
    const stored = "https://www.linkedin.com/in/danaschlessinger";
    expect(linkedinHref(stored, "Dana Schlessinger", "Schlessinger MD")).toBe(stored);
    expect(linkedinHref(stored, null, "Schlessinger MD")).toBe(stored);
  });

  it("falls back to a people-search on name + practice", () => {
    expect(linkedinHref(null, "Dana Schlessinger", "Schlessinger MD")).toBe(
      "https://www.linkedin.com/search/results/people/?keywords=Dana%20Schlessinger%20Schlessinger%20MD",
    );
  });

  it("falls back to practice-only when the name is null — D9's role-only contact", () => {
    // The MAJORITY outcome on the U5 cohort (3 of 5 practices returned no named person),
    // so this is the common path, not an edge case. Nothing invents a name to search for.
    expect(linkedinHref(null, null, "Schlessinger MD")).toBe(
      "https://www.linkedin.com/search/results/people/?keywords=Schlessinger%20MD",
    );
  });

  it("treats an empty stored URL as no URL", () => {
    expect(linkedinHref("", null, "Schlessinger MD")).toBe(
      "https://www.linkedin.com/search/results/people/?keywords=Schlessinger%20MD",
    );
  });

  it("encodes the keywords, and never throws", () => {
    expect(linkedinHref(null, "Dana O’Neil", "Head & Neck, PC")).toBe(
      "https://www.linkedin.com/search/results/people/?keywords=Dana%20O%E2%80%99Neil%20Head%20%26%20Neck%2C%20PC",
    );
    expect(() => linkedinHref(null, "\uD800", "Clinic")).not.toThrow();
  });
});

describe("facebookHref — the personal path (D7's mutual-connections prompt)", () => {
  it("searches on name + practice", () => {
    expect(facebookHref("Dana Schlessinger", "Schlessinger MD")).toBe(
      "https://www.facebook.com/search/people/?q=Dana%20Schlessinger%20Schlessinger%20MD",
    );
  });

  it("handles a null name by searching the practice alone", () => {
    expect(facebookHref(null, "Schlessinger MD")).toBe(
      "https://www.facebook.com/search/people/?q=Schlessinger%20MD",
    );
  });

  it("encodes `&` and `,`, and never throws", () => {
    expect(facebookHref(null, "Head & Neck, PC")).toBe(
      "https://www.facebook.com/search/people/?q=Head%20%26%20Neck%2C%20PC",
    );
    expect(() => facebookHref("\uD800", "Clinic")).not.toThrow();
  });

  it("leaves a hyphen alone — `%2D` is a text-fragment rule, not a query-string one", () => {
    // The distinction matters: `encodeTextFragmentTerm` escapes `-` because the directive
    // grammar reserves it. A query string does not, and `%2D` here would only obfuscate.
    expect(facebookHref(null, "Well-Being Clinic")).toBe(
      "https://www.facebook.com/search/people/?q=Well-Being%20Clinic",
    );
    expect(linkedinHref(null, null, "Well-Being Clinic")).toContain("Well-Being");
  });
});
