import { describe, expect, it } from "vitest";
import {
  cleanHtml,
  HTML_TEXT_CAP,
  TRUNCATION_MARKER,
} from "@/src/enrich/html-clean";

/**
 * Pure. No network, no fixtures on disk — the HTML is the input.
 *
 * The load-bearing test in this file is the LAST one: `cleanHtml` must not
 * rewrite a word, a quote, or a dash. If it does, `citations.ts` will drop a true
 * fact as "not verbatim" and the drop will be blamed on the model.
 */

/** Three sections is the floor for structured extraction; give it four. */
function structuredBody(extra = ""): string {
  return `<body>
    ${extra}
    <h1>Sunshine Dermatology</h1>
    <p>Sunshine Dermatology has served the Omaha metro since 2004.</p>
    <p>Our providers treat both medical and cosmetic dermatology.</p>
  </body>`;
}

describe("cleanHtml — what the extractor is allowed to see", () => {
  it("removes <script> and <style> and never emits their text", () => {
    const html = structuredBody(
      `<script>var token = "SCRIPTSECRET";</script>
       <style>.a { color: red } /* STYLESECRET */</style>`,
    );
    const text = cleanHtml(html);

    expect(text).not.toContain("SCRIPTSECRET");
    expect(text).not.toContain("STYLESECRET");
    expect(text).toContain("Sunshine Dermatology");
  });

  it("ERROR PATH: script text does not leak through the raw-body fallback either", () => {
    // Only one section -> the <3 fallback fires. That branch reads `$('body').text()`,
    // which would happily include script source if the removal ran after it.
    const html = `<body><script>var token = "SCRIPTSECRET";</script><h1>Alpha</h1></body>`;
    expect(cleanHtml(html)).not.toContain("SCRIPTSECRET");
  });

  it("dedupes a heading repeated in a menu and in the body", () => {
    const html = `<body>
      <div class="site-menu"><h2>Our Team</h2></div>
      <main>
        <h2>Our Team</h2>
        <p>Dr. Joel Schlessinger founded the practice in 2004.</p>
        <p>Dr. Paula Orr joined the group as a dermatologist.</p>
      </main>
    </body>`;
    const text = cleanHtml(html);

    expect(text.match(/Our Team/g)).toHaveLength(1);
  });

  it("strips <nav>, <header> and <footer> wholesale", () => {
    const html = structuredBody(
      `<nav><a href="/x">NAVCHROME</a></nav>
       <header>HEADERCHROME</header>
       <footer>FOOTERCHROME</footer>`,
    );
    const text = cleanHtml(html);

    expect(text).not.toContain("NAVCHROME");
    expect(text).not.toContain("HEADERCHROME");
    expect(text).not.toContain("FOOTERCHROME");
  });

  it("EDGE CASE: fewer than 3 structured sections falls back to raw body text", () => {
    const html = `<body><h1>Alpha</h1><h2>Beta</h2><p>short</p></body>`;
    const text = cleanHtml(html);

    expect(text).toBe("Alpha Beta short");
    // The fallback is raw text, so it carries no markdown heading prefixes.
    expect(text).not.toContain("#");
  });

  it("EDGE CASE: the raw-body fallback separates blocks but never splits inline tags", () => {
    // Two failure modes, one test. Naive `$('body').text()` welds the two <div>s
    // into "Sunshine DermOmaha". Naively spacing EVERY element splits the <b> into
    // "Sun shine". Both produce a page string the verifier can never match.
    const html = `<body><div>Sun<b>shine</b> Derm</div><div>Omaha</div></body>`;
    expect(cleanHtml(html)).toBe("Sunshine Derm Omaha");
  });

  it("EDGE CASE: an empty body yields an empty string, not a crash", () => {
    expect(cleanHtml("<body></body>")).toBe("");
  });

  it("EDGE CASE: HTML entities are decoded, so '&amp;' cites as '&'", () => {
    const html = `<body><div>Skin &amp; Cancer Center</div></body>`;
    expect(cleanHtml(html)).toBe("Skin & Cancer Center");
  });

  it("truncates above the cap and marks the truncation", () => {
    const paragraphs = Array.from(
      { length: 300 },
      (_, i) => `<p>Paragraph number ${i} describing this practice in detail.</p>`,
    ).join("");
    const text = cleanHtml(`<body><h1>Big</h1>${paragraphs}</body>`);

    expect(text.endsWith(TRUNCATION_MARKER)).toBe(true);
    expect(text).toHaveLength(HTML_TEXT_CAP + TRUNCATION_MARKER.length);
  });

  it("EDGE CASE: empty / non-string input returns '' without throwing", () => {
    expect(cleanHtml("")).toBe("");
    expect(cleanHtml(null as never)).toBe("");
    expect(cleanHtml(undefined as never)).toBe("");
    expect(cleanHtml(42 as never)).toBe("");
  });

  it("collapses whitespace runs but never rewrites a word, quote, or dash", () => {
    // M2's substrate. The verifier normalizes case/whitespace/quotes/dashes on BOTH
    // sides — but only if the characters survive to be normalized. If cleanHtml
    // straightened this curly quote, a snippet quoting the page would still verify;
    // if it DROPPED the em-dash, a true fact would be reported as fabricated.
    const html = structuredBody(
      `<p>Dr. Joel Schlessinger — board-certified — says “we love it”.</p>`,
    );
    const text = cleanHtml(html);

    expect(text).toContain(
      "Dr. Joel Schlessinger — board-certified — says “we love it”.",
    );
  });

  it("heading prefixes are additive, so a heading is still a verbatim substring", () => {
    const text = cleanHtml(structuredBody());
    expect(text).toContain("# Sunshine Dermatology");
    // The bare heading text — what a model would cite — survives inside it.
    expect(text).toContain("Sunshine Dermatology");
  });
});
