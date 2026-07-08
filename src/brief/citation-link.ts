/**
 * Every link on the brief, built to land the reader on the SENTENCE rather than the page.
 * Lilly's directive #1: "clickable sources that go as directly as possible to where that
 * information came from."
 *
 * This file is only buildable because `src/enrich/citations.ts` already did the hard part.
 * A stored `snippet` is a verbatim, contiguous span of the page at its `sourceUrl` —
 * *checked*, not promised. So a scroll-to-text-fragment URL
 * (`https://example.com/team#:~:text=Dr.%20Ann%20Lee`) will find its target: the browser
 * searches the page for text we have already proven is on it. Delete the verification pass
 * and this whole file becomes a coin flip — and a link that scrolls to the *wrong* sentence
 * is worse than a link that scrolls to none, because it looks like it worked.
 *
 * Pure: no network, no DB, no clock. Mirrors `gaps.ts` and `citations.ts`.
 *
 * ─── The one rule: a link never fails, it only gets shallower ─────────────────
 *
 * Every degradation in here ends at the same safe place — the correct page, at the top.
 * No snippet, an unparseable URL, a fragment someone else already owns, a snippet too long
 * to quote whole, a snippet with no word boundary to cut on: each returns something a
 * reader can click. `citationHref` therefore has no failure mode and no error type. It is
 * total by construction, not by rescue — see `encodeTextFragmentTerm`, where the one input
 * that can make `encodeURIComponent` throw is repaired before it gets there.
 */

/** Matches `normalizeForCitation`'s whitespace rule. See `collapseWhitespace`. */
const WHITESPACE_RUN = /\s+/g;
/** ASCII hyphen-minus only. The em/en dashes are NOT folded — see `collapseWhitespace`. */
const LITERAL_HYPHEN = /-/g;

/** The first `#` in a URL string begins its fragment, exactly as `new URL` reads it. */
const FRAGMENT_DELIMITER = "#";
/**
 * `:~:` — the fragment-directive delimiter. Everything after it is instructions for the
 * browser, not a element id. Its presence in a fragment means someone else already owns
 * that space, and we do not append to a directive we did not write.
 */
const FRAGMENT_DIRECTIVE = ":~:";

/**
 * Above this many characters we stop quoting the snippet whole and emit the `start,end`
 * range form instead.
 *
 * A single enormous `text=` term is fragile: it must match the page's rendered text
 * *exactly*, and every extra character is another chance for a stray non-breaking space,
 * a soft hyphen, or an inline `<sup>` to break the match. The range form asks the browser
 * for two short anchors and lets it span whatever sits between them.
 *
 * Must stay comfortably above `2 * RANGE_TERM_MAX_CHARS` — see the non-overlap guard in
 * `textDirective`.
 */
export const TEXT_FRAGMENT_MAX_EXACT = 300;

/** Longest `start` / `end` anchor in the range form, trimmed back to a word boundary. */
export const RANGE_TERM_MAX_CHARS = 40;

/**
 * `normalizeForCitation`'s whitespace rule, and *only* that rule.
 *
 * That function also lowercases and folds curly quotes and en/em dashes. Correct there:
 * it compares two strings we hold, and any transform applied to both sides is free. Here
 * the comparison happens in the BROWSER, against the real characters rendered on the page.
 * Fold `’` to `'` and the fragment stops matching a page that genuinely says `’`. Lowercase
 * and nothing breaks — the browser matches case-insensitively — but it buys nothing either,
 * so the safe rule is to touch as little as possible.
 *
 * Whitespace is different in kind. A text fragment matches against RENDERED text, in which
 * a newline between two words is one space; our snippets come out of cleaned HTML and carry
 * the source's line breaks. Collapsing is what makes the snippet comparable at all.
 */
function collapseWhitespace(text: string): string {
  return text.replace(WHITESPACE_RUN, " ").trim();
}

/**
 * Percent-encode a string for a URL component, for any string at all.
 *
 * `encodeURIComponent` throws `URIError` on a **lone surrogate** — half of a character,
 * which a truncated or mis-decoded page can hand us, and which `textDirective`'s own
 * fixed-width fallback cut can *create* by slicing an emoji down the middle. This module
 * promises never to throw, so the surrogate is repaired to U+FFFD first. The fragment then
 * matches nothing (no page contains a lone surrogate either) and the reader lands at the
 * top of the correct page — this file's whole degradation story, applied to its one
 * genuinely un-encodable input.
 */
function percentEncode(text: string): string {
  return encodeURIComponent(text.toWellFormed());
}

/**
 * Encode one term of a text directive.
 *
 * The scroll-to-text-fragment grammar reserves three characters INSIDE a term:
 *
 *   `&`  ends the directive     — `#:~:text=a&text=b` is *two* directives
 *   `,`  separates terms        — `text=start,end`
 *   `-`  marks prefix/suffix    — `text=prefix-,start,end,-suffix`
 *
 * `encodeURIComponent` escapes the first two (`%26`, `%2C`) and leaves the third alone:
 * `-` is an RFC 3986 *unreserved* character, and the URL spec has no opinion about a
 * grammar layered on top of the fragment. So a snippet reading "board-certified" silently
 * becomes the prefix directive `board-` + the term `certified`, and matches nothing.
 * Escape the hyphen by hand.
 *
 * Doing that replace AFTER encoding is safe, and only after: a percent-escape is `%` plus
 * two hex digits, and no hex digit is `-`. Every hyphen left in the encoded string is a
 * literal one from the input.
 */
function encodeTextFragmentTerm(text: string): string {
  return percentEncode(text).replace(LITERAL_HYPHEN, "%2D");
}

/**
 * The longest prefix of `text` that fits in `maxChars` and ends on a word boundary, or
 * `""` when the first `maxChars` characters hold no boundary to cut on.
 *
 * Whole words matter because the browser's matcher anchors each term at word boundaries:
 * a term of `"board-certi"` will not match `"board-certified"`. Returning `""` rather than
 * a half-word is how the caller learns to try something else.
 *
 * `text` is always a collapsed snippet — trimmed, single-spaced — so a boundary is a `" "`
 * and a cut on one can never split a surrogate pair.
 */
function wholeWordPrefix(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  // The character the cut displaced is a space: the cut already fell on a boundary.
  if (text[maxChars] === " ") return text.slice(0, maxChars);
  const head = text.slice(0, maxChars);
  const lastSpace = head.lastIndexOf(" ");
  return lastSpace <= 0 ? "" : head.slice(0, lastSpace);
}

/** `wholeWordPrefix` from the other end: the longest boundary-aligned suffix, or `""`. */
function wholeWordSuffix(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const cut = text.length - maxChars;
  if (text[cut - 1] === " ") return text.slice(cut);
  const tail = text.slice(cut);
  const firstSpace = tail.indexOf(" ");
  return firstSpace === -1 ? "" : tail.slice(firstSpace + 1);
}

/** Everything after `text=`, for a snippet already collapsed and known non-empty. */
function textDirective(collapsed: string): string {
  if (collapsed.length <= TEXT_FRAGMENT_MAX_EXACT) return encodeTextFragmentTerm(collapsed);

  const start = wholeWordPrefix(collapsed, RANGE_TERM_MAX_CHARS);
  const end = wholeWordSuffix(collapsed, RANGE_TERM_MAX_CHARS);

  // Both terms are substrings by construction — one a prefix, one a suffix. The only thing
  // left to prove is that they neither touch nor overlap: a `text=a,b` whose `b` begins
  // before `a` ends selects nothing, or worse, some other span of the page. As the
  // constants stand this cannot fail (a >300-char snippet leaves >=220 characters between
  // two <=40-char terms), but both are tunable and the failure would be silent, so it is
  // checked rather than assumed. `tests/brief/citation-link.test.ts` pins the invariant.
  if (start !== "" && end !== "" && start.length < collapsed.length - end.length) {
    // The `,` between the halves stays literal — it is the separator. Each half encodes
    // its own commas to `%2C`, so exactly one literal comma survives in the directive.
    return `${encodeTextFragmentTerm(start)},${encodeTextFragmentTerm(end)}`;
  }

  // No safe pair. Quote the head of the snippet exactly, cut on a word boundary.
  const head = wholeWordPrefix(collapsed, TEXT_FRAGMENT_MAX_EXACT);
  // ...and when there is no boundary either — a single unbroken token longer than the cap,
  // e.g. a base64 blob or a run of emoji — take the fixed-width slice. It will not match
  // (the browser needs a word boundary), and that is fine. An UNMATCHABLE directive leaves
  // the reader on the right page; an EMPTY one (`#:~:text=`) is a malformed URL.
  return encodeTextFragmentTerm(head === "" ? collapsed.slice(0, TEXT_FRAGMENT_MAX_EXACT) : head);
}

/** The deepest link the evidence supports. Never throws. */
export function citationHref(sourceUrl: string, snippet?: string | null): string {
  // No evidence to point at, so there is nothing deeper than the page itself. Note this
  // also catches `"   "`, which zod's `min(1)` accepts and which would otherwise encode to
  // an empty directive — the same `"".includes()` hole `verifyFact` closes one layer up.
  const collapsed = collapseWhitespace(snippet ?? "");
  if (collapsed === "") return sourceUrl;

  // A fragment can only be appended to something the browser will resolve. Hand back the
  // caller's own string rather than throwing: `sourceUrl` is an identifier we were given,
  // and this function's contract is that it always returns something clickable.
  if (!URL.canParse(sourceUrl)) return sourceUrl;

  // Parse the fragment off the STRING, never off a `new URL()`. Re-serializing a `URL`
  // normalizes it — lowercases the host, adds a trailing slash to a bare origin, re-encodes
  // the query — and `sourceUrl` is the exact identifier `citations.ts` verified the snippet
  // against and that `evidence.source_url` stores. The href must name the same page.
  const hashIndex = sourceUrl.indexOf(FRAGMENT_DELIMITER);
  const fragment = hashIndex === -1 ? "" : sourceUrl.slice(hashIndex + 1);

  // Someone already put a directive here. Appending a second `:~:` produces a fragment no
  // browser will honour, and we would be overwriting an instruction we did not author.
  if (fragment.includes(FRAGMENT_DIRECTIVE)) return sourceUrl;

  // `https://x/team`  -> `https://x/team#:~:text=…`   (open a fragment)
  // `https://x/team#` -> `https://x/team#:~:text=…`   (the fragment is already open)
  // `https://x#team`  -> `https://x#team:~:text=…`    (keep the element id, add a directive)
  const separator = hashIndex === -1 ? FRAGMENT_DELIMITER : "";
  return `${sourceUrl}${separator}${FRAGMENT_DIRECTIVE}text=${textDirective(collapsed)}`;
}

/**
 * What to type into a people search. The practice name is the disambiguator that makes a
 * common personal name findable, so it is always present; the name is not, because D9's
 * role-only contact was the MAJORITY outcome on the U5 cohort.
 */
function peopleSearchKeywords(name: string | null, practiceName: string): string {
  return name ? `${name} ${practiceName}` : practiceName;
}

/** The contact's own profile if we hold one, else a LinkedIn people-search for name+practice. */
export function linkedinHref(
  linkedinUrl: string | null,
  name: string | null,
  practiceName: string,
): string {
  // Returned verbatim, on purpose. `normalizeLinkedinUrl` (U5, `src/enrich/gaps.ts`) already
  // guaranteed at the persist boundary that a stored URL carries a scheme — PDL hands back
  // `linkedin.com/in/x`, which a browser resolves as a *relative* path. Re-normalizing here
  // would be a second rule enforcing the same invariant, and two rules drift.
  if (linkedinUrl) return linkedinUrl;

  // We never scrape mutual connections — that needs an authenticated session. Handing the
  // AE the search and letting LinkedIn surface them at the top of the result is D7's
  // "check for mutual connections" prompt, honestly implemented.
  //
  // Plain `percentEncode`, not `encodeTextFragmentTerm`: a hyphen is an ordinary character
  // in a query string, and `%2D` here would only make the URL harder to read.
  const keywords = percentEncode(peopleSearchKeywords(name, practiceName));
  return `https://www.linkedin.com/search/results/people/?keywords=${keywords}`;
}

/** Facebook people-search — the personal path, per the spec's D7 "check for mutual connections" prompt. */
export function facebookHref(name: string | null, practiceName: string): string {
  const keywords = percentEncode(peopleSearchKeywords(name, practiceName));
  return `https://www.facebook.com/search/people/?q=${keywords}`;
}
