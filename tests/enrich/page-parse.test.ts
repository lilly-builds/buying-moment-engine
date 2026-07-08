import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  bucketFor,
  discoverLinks,
  extractMetaFallback,
  normalizeSiteUrl,
} from "@/src/enrich/page-parse";

/** Pure. Given HTML and an origin: which pages, and what does a JS shell still say? */

const ORIGIN = "https://sunshinederm.example";
const HOME_HTML = readFileSync(
  new URL("./fixtures/site-home.html", import.meta.url),
  "utf8",
);
const SPA_HTML = readFileSync(
  new URL("./fixtures/site-spa-home.html", import.meta.url),
  "utf8",
);

describe("discoverLinks — which of a practice's own pages we hold", () => {
  const { paths, buckets } = discoverLinks(HOME_HTML, ORIGIN);

  it("classifies one page per healthcare bucket", () => {
    expect(buckets.team).toContain("/OurTeam");
    expect(buckets.about).toContain("/about-us");
    expect(buckets.locations).toContain("/locations");
    expect(buckets.services).toContain("/services");
    expect(buckets.patients).toContain("/new-patients");
    expect(buckets.careers).toContain("/careers");
  });

  it("PRESERVES original path case — a case-sensitive host 404s `/ourteam`", () => {
    // Optiflow lowercases the path it then fetches. On a case-sensitive host that
    // silently loses the staff page, which is the one page we cannot do without.
    expect(paths).toContain("/OurTeam");
    expect(paths).not.toContain("/ourteam");
  });

  it("dedupes case-insensitively, so `/OURTEAM` is not a second page", () => {
    expect(paths.filter((p) => p.toLowerCase() === "/ourteam")).toHaveLength(1);
  });

  it("excludes asset links", () => {
    expect(paths).not.toContain("/patient-brochure.pdf");
    expect(paths).not.toContain("/assets/logo.png");
  });

  it("excludes framework and CMS noise", () => {
    expect(paths.some((p) => p.startsWith("/wp-"))).toBe(false);
    expect(paths.some((p) => p.startsWith("/_next"))).toBe(false);
  });

  it("excludes off-host absolute and protocol-relative links", () => {
    expect(paths.some((p) => p.includes("facebook"))).toBe(false);
    expect(paths.some((p) => p.includes("tracker"))).toBe(false);
  });

  it("excludes mailto:, tel:, and bare fragments", () => {
    expect(paths.some((p) => p.includes("@"))).toBe(false);
    expect(paths.some((p) => p.includes("+1402"))).toBe(false);
    expect(paths).not.toContain("/");
  });

  it("includes BOTH a relative link and a same-host absolute link", () => {
    expect(paths).toContain("/about-us"); // href="/about-us"
    expect(paths).toContain("/services"); // href="https://sunshinederm.example/services"
  });

  it("strips a trailing slash so `/new-patients/` is one page", () => {
    expect(paths).toContain("/new-patients");
    expect(paths).not.toContain("/new-patients/");
  });

  it("EDGE CASE: HTML with no links yields no paths and empty buckets", () => {
    const { paths: none, buckets: empty } = discoverLinks("<body></body>", ORIGIN);
    expect(none).toEqual([]);
    expect(empty.team).toEqual([]);
  });

  it("ERROR PATH: an href that fails URL parsing is skipped, not thrown on", () => {
    // `new URL("http://", base)` genuinely throws. This is what the catch is for.
    const html = `<body><a href="http://">bad</a><a href="/our-team">ok</a></body>`;
    expect(discoverLinks(html, ORIGIN).paths).toEqual(["/our-team"]);
  });

  it("ERROR PATH: an invalid scheme resolves as a same-host path — but is never bucketed", () => {
    // `new URL(href, base)` almost never throws: an unparseable scheme like `ht!tp:`
    // is treated as a path segment, so the host check passes. The guard that actually
    // protects us is therefore NOT the try/catch — it is that `scrape.ts` only ever
    // fetches BUCKETED paths, and junk lands in no bucket.
    const { paths, buckets } = discoverLinks(`<body><a href="ht!tp://[">x</a></body>`, ORIGIN);
    expect(paths).toHaveLength(1);
    expect(Object.values(buckets).flat()).toEqual([]);
  });
});

describe("bucketFor — first bucket in priority order wins", () => {
  it("puts a nested team page in `team`, not `about`", () => {
    expect(bucketFor("/about/our-team")).toBe("team");
  });

  it.each([
    ["/our-team", "team"],
    ["/staff-directory", "team"],
    ["/physicians", "team"],
    ["/about-us", "about"],
    ["/contact-us", "locations"],
    ["/services", "services"],
    ["/new-patient-forms", "patients"],
    ["/careers", "careers"],
    ["/blog", "news"],
  ])("%s -> %s", (path, bucket) => {
    expect(bucketFor(path)).toBe(bucket);
  });

  it("returns null for a page in no bucket", () => {
    expect(bucketFor("/privacy-policy")).toBeNull();
  });
});

describe("extractMetaFallback — what a JS shell still tells us", () => {
  const text = extractMetaFallback(SPA_HTML);

  it("pulls title, meta description, and og:* tags", () => {
    expect(text).toContain("# Westlake Dermatology");
    expect(text).toContain("Dermatology and plastic surgery across Central Texas.");
    expect(text).toContain("Westlake Dermatology & Cosmetic Surgery");
    expect(text).toContain("Twenty-two locations across Central Texas.");
  });

  it("pulls citable business facts out of JSON-LD", () => {
    expect(text).toContain("Business: Westlake Dermatology");
    expect(text).toContain("Board-certified dermatologists and plastic surgeons.");
    expect(text).toContain("Address: 2801 Bee Cave Rd, Austin, TX");
    expect(text).toContain("Phone: (512) 328-3376");
    expect(text).toContain("Specialty: Dermatology");
  });

  it("ERROR PATH: a malformed JSON-LD block is absent, not fatal", () => {
    // The fixture ships one valid and one broken <script type=ld+json>.
    expect(text).toContain("Business: Westlake Dermatology");
  });

  it("labels are additive, so the value is still a verbatim substring (M2)", () => {
    expect(text).toContain("(512) 328-3376");
  });

  it("flattens a JSON-LD `@graph`", () => {
    const html = `<script type="application/ld+json">
      {"@graph":[{"name":"Grin Eye Care","telephone":"913-829-5511"}]}
    </script>`;
    const out = extractMetaFallback(html);
    expect(out).toContain("Business: Grin Eye Care");
    expect(out).toContain("Phone: 913-829-5511");
  });

  it("EDGE CASE: a page with no head metadata yields ''", () => {
    expect(extractMetaFallback("<body><p>hi</p></body>")).toBe("");
  });
});

describe("normalizeSiteUrl", () => {
  it("adds https:// to a bare host", () => {
    expect(normalizeSiteUrl("sunshinederm.example")).toEqual({
      base: "https://sunshinederm.example",
      origin: "https://sunshinederm.example",
    });
  });

  it("strips a trailing slash but keeps a sub-path", () => {
    expect(normalizeSiteUrl("https://x.example/locations/omaha/")).toEqual({
      base: "https://x.example/locations/omaha",
      origin: "https://x.example",
    });
  });

  it("keeps an http:// scheme rather than silently upgrading it", () => {
    expect(normalizeSiteUrl("http://x.example")?.origin).toBe("http://x.example");
  });

  it.each(["", "   ", "not a url", "javascript:alert(1)", "ftp://x.example"])(
    "ERROR PATH: %j is not fetchable -> null",
    (raw) => {
      expect(normalizeSiteUrl(raw)).toBeNull();
    },
  );
});
