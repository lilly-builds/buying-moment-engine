import * as cheerio from "cheerio";

/**
 * HTML -> clean text. Ported from `lead-gen-optiflow/src/utils/html-cleaner.ts`,
 * which uses it to write voicemail scripts. Here it does something stricter, so
 * one rule is added that the original never needed:
 *
 * WHATEVER THIS FILE REWRITES CAN NEVER BE VERIFIED. `citations.ts` asserts that
 * the model's snippet is a verbatim substring of THIS function's output (M2). The
 * only transforms allowed here are ones the verifier's normalizer also applies —
 * whitespace collapsing and structural joins. We drop nodes and we collapse
 * spacing; we never rewrite a word, a quote, or a dash. Do that and a true fact
 * gets dropped as "not verbatim", and the drop looks like a model failure.
 *
 * Pure: no network, no I/O. The `<h1>`-`<h4>` markdown prefixes are additive, so
 * a snippet quoting a heading still verifies as a substring of `## Our Team`.
 */

/** Per-page ceiling. `scrape.ts` owns the cross-page total. */
export const HTML_TEXT_CAP = 8_000;

/** Appended when the cap bites, so a truncated page is never silently short. */
export const TRUNCATION_MARKER = "\n\n[truncated]";

/**
 * Below this many structured sections, the page's markup told us nothing (a SPA
 * shell, a `<div>` soup) and we fall back to raw body text rather than shipping
 * two headings as the whole page.
 */
const MIN_STRUCTURED_SECTIONS = 3;

/**
 * A `<p>`/`<li>` shorter than this is nav chrome ("Home", "Contact"), not prose.
 * Carried over from Optiflow at 20 — the number the E5/E7 measurements were taken
 * against. It does drop very short facts (`<li>ModMed</li>`); U8 measures the real
 * verified-fact count, which is the evidence to retune this on. Not a guess to
 * revise on a hunch.
 */
const MIN_PARAGRAPH_CHARS = 20;

const NOISE_SELECTOR =
  "script, style, noscript, iframe, svg, link, meta, nav, footer, header";
const HIDDEN_SELECTOR =
  '[style*="display:none"], [style*="display: none"], .hidden, [aria-hidden="true"]';
const HEADING_SELECTOR = "h1, h2, h3, h4";
const PROSE_SELECTOR = "p, li, td, blockquote";

/**
 * Elements whose boundaries are word boundaries. Used ONLY by the raw-body
 * fallback — see `rawBodyText`. Inline tags (`b`, `em`, `span`, `a`) are
 * deliberately absent.
 */
const BLOCK_SELECTOR = [
  "address", "article", "aside", "blockquote", "br", "dd", "div", "dl", "dt",
  "fieldset", "figcaption", "figure", "form", "h1", "h2", "h3", "h4", "h5",
  "h6", "hr", "li", "main", "ol", "p", "pre", "section", "table", "td", "th",
  "tr", "ul",
].join(",");

function headingPrefix(tagName: string): string {
  switch (tagName.toLowerCase()) {
    case "h1":
      return "# ";
    case "h2":
      return "## ";
    default:
      return "### ";
  }
}

/** Collapse runs of blank lines and horizontal whitespace. Words are untouched. */
function collapseWhitespace(text: string): string {
  return text
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function applyCap(text: string): string {
  if (text.length <= HTML_TEXT_CAP) return text;
  return text.slice(0, HTML_TEXT_CAP) + TRUNCATION_MARKER;
}

/** First occurrence wins. A heading repeated in a menu and the body lands once. */
function dedupe(sections: string[]): string[] {
  const seen = new Set<string>();
  return sections.filter((section) => {
    const key = section.toLowerCase().trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * The fallback substrate, when markup gave us no structure to extract.
 *
 * `$('body').text()` concatenates with NO separator, so `<h1>Alpha</h1><h2>Beta</h2>`
 * comes back as `"AlphaBeta"` — two facts welded into a word that appears on no
 * page, and therefore a snippet the verifier can never match. Insert a space around
 * BLOCK elements to restore the word boundaries the markup implied.
 *
 * Only block elements. Doing this around inline tags would turn `Sun<b>shine</b>`
 * into `"Sun shine"` — the same defect running the other way.
 */
function rawBodyText($: cheerio.CheerioAPI): string {
  $("body")
    .find(BLOCK_SELECTOR)
    .each((_, el) => {
      $(el).before(" ").after(" ");
    });
  return $("body").text().replace(/\s+/g, " ").trim();
}

export function cleanHtml(html: string): string {
  if (!html || typeof html !== "string") return "";

  const $ = cheerio.load(html);
  $(NOISE_SELECTOR).remove();
  $(HIDDEN_SELECTOR).remove();

  const sections: string[] = [];
  $(HEADING_SELECTOR).each((_, el) => {
    const text = $(el).text().trim();
    if (text.length > 1) sections.push(headingPrefix(el.tagName) + text);
  });
  $(PROSE_SELECTOR).each((_, el) => {
    const text = $(el).text().trim();
    if (text.length > MIN_PARAGRAPH_CHARS) sections.push(text);
  });

  if (sections.length < MIN_STRUCTURED_SECTIONS) {
    // Replace, don't append: the body text already contains every heading we
    // found, so appending would ship the same words twice and pay tokens for it.
    return applyCap(rawBodyText($));
  }

  return applyCap(collapseWhitespace(dedupe(sections).join("\n\n")));
}
