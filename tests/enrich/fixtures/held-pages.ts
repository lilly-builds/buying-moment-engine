/**
 * The pages the fake scraper "holds" for each fixture practice.
 *
 * Every `snippet` in `anthropic-research-*.json` MUST appear verbatim in the page its
 * `sourceUrl` names, or `verifyFindings` drops the fact and the integration test fails.
 * That coupling is deliberate and load-bearing: before this refactor a fixture could
 * cite `https://sunshinederm.example/team` and quote anything at all, because nothing
 * held the page. Now the test data has to be internally honest, exactly as the live
 * data must be. The verifier grades our fixtures too.
 *
 * `harborvision.example` is keyed WITHOUT a trailing slash while its fixture cites
 * `https://harborvision.example/` — the trailing-slash tolerance in `citations.ts`,
 * exercised end-to-end rather than only in a unit test.
 */

export const SUNSHINE_PAGES = new Map([
  [
    "https://sunshinederm.example/about",
    "# About us\n\nSunshine Dermatology Associates is a full-service dermatology group.\nWe have served South Florida since 2004.",
  ],
  [
    "https://sunshinederm.example/team",
    "# Our team\n\nDana Whitfield, Practice Administrator\n\nDr. Elena Ruiz, Dermatologist",
  ],
  [
    "https://sunshinederm.example/patient-portal",
    "# Patient portal\n\nOur patient portal is powered by ModMed EMA.",
  ],
  [
    "https://sunshinederm.example/reviews",
    "# Reviews\n\nReviews collected via Podium.",
  ],
  [
    "https://sunshinederm.example/news/hialeah",
    "# Expanding to Hialeah\n\nWe are thrilled to announce our fourth location, opening in Hialeah this fall.",
  ],
]);

export const METRO_PAGES = new Map([
  [
    "https://metroortho.example/about",
    "# About\n\nMetro Ortho Group is Denver's largest independent orthopedic practice.",
  ],
  [
    "https://metroortho.example/portal",
    "# Records\n\nOur records live in Phoenix Ortho.",
  ],
  [
    "https://metroortho.example/leadership",
    "# Leadership\n\nMarcus Iyer, Chief Operating Officer\n\nContact Marcus at marcus.iyer@metroortho.example\n\nConnect with Marcus on LinkedIn: linkedin.com/in/marcus-iyer-example",
  ],
]);

export const HARBOR_PAGES = new Map([
  // No trailing slash on the key; the fixture cites `.../` — see the note above.
  [
    "https://harborvision.example",
    "# Harbor Vision Eye Care\n\nHarbor Vision Eye Care has served Portland since 1998.",
  ],
  [
    "https://harborvision.example/careers",
    "# Careers\n\nFront desk coordinator wanted. Report directly to the Office Manager.",
  ],
]);
