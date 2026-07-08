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

export const SUNSHINE_TEAM_URL = "https://sunshinederm.example/team";

export const SUNSHINE_PAGES = new Map([
  [
    "https://sunshinederm.example/about",
    "# About us\n\nSunshine Dermatology Associates is a full-service dermatology group.\nWe have served South Florida since 2004.",
  ],
  [
    SUNSHINE_TEAM_URL,
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

/**
 * Sunshine, six months later: Dana Whitfield's title on the team page now reads
 * "Practice Manager".
 *
 * A role DRIFT has to move the page, not just the model's `value`. `decisionMaker.role`
 * is a QUOTATION field (`citations.ts`), so a run that reports "Practice Manager" while
 * the page still says "Practice Administrator" is not a re-titled employee — it is a
 * fabricated value on a real snippet, and the verifier is supposed to drop it. Drifting
 * only the value would make the drift test assert the opposite of the guarantee.
 */
export const SUNSHINE_PAGES_ROLE_DRIFTED = new Map(SUNSHINE_PAGES).set(
  SUNSHINE_TEAM_URL,
  "# Our team\n\nDana Whitfield, Practice Manager\n\nDr. Elena Ruiz, Dermatologist",
);

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
