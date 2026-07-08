/**
 * THE REAL PAGE, and the real fabrication it caught.
 *
 * Captured 2026-07-08 by running the production scraper (`scrapePractice`, honest
 * UA, robots-checked) against https://www.schlessingermd.com/ — one of the ten
 * practices in `experiment-1-cohort.json`. This is a verbatim PREFIX of what
 * `cleanHtml()` produced for the team page; only the trailing address / phone /
 * footer-nav lines are cut. Nothing inside it is rewritten, because the whole point
 * of the fixture is that the verifier compares against exactly this.
 *
 * Public business information about named physicians on their own practice site.
 * No patient data, no PHI, nothing behind a login (D9).
 *
 * Why it is here: in E7 round 1, Haiku 4.5 returned a `firmographics.providerCount`
 * fact cited to this URL, with STITCHED_PROVIDER_COUNT as its snippet. Those three
 * names are on the page — as three separate `<h2>` headings. The comma-joined run
 * the model produced appears nowhere. Under the old agentic mechanism the fact
 * would have shipped into a brief carrying a real sourceUrl and a plausible
 * snippet, undetectable, because we never held the page.
 *
 * That catch is why `providerCount` and `locationsCount` are no longer LLM-cited
 * fields at all (KTD-4) — a tally has no contiguous sentence that proves it.
 */

export const SCHLESSINGER_TEAM_URL =
  "https://www.schlessingermd.com/skin-specialists-omaha/our-team";

/**
 * The exact string Haiku returned as evidence for "5 providers". Every name in it
 * is real; the SEQUENCE is invented. `citations.ts` exists to notice the difference.
 */
export const STITCHED_PROVIDER_COUNT =
  "Joel Schlessinger, MD, Daniel Schlessinger, MD, Jackie Gaffney, MPAS-C";

/** A genuine contiguous span from the same page — the positive control. */
export const VERBATIM_SPAN =
  "Consistently voted the best dermatologist and cosmetic surgeon in Omaha";

/**
 * The same span as the page states it, but typed with a straight apostrophe where
 * the page uses a curly one. Normalization must let this through; if it did not,
 * a TRUE fact would be dropped as fabrication and the drop would look like a model
 * failure.
 */
export const CURLY_QUOTE_SPAN = "Dr. Schlessinger's unwavering commitment to excellence";

export const SCHLESSINGER_TEAM_TEXT = `# Our team

## Joel Schlessinger, MD

## Daniel Schlessinger, MD

## Jackie Gaffney, MPAS-C

## Shea Perillo, MPAS-C

## Lauren Gerace, MPAS-C

## We are honored to have won local & national awards

## Nursing team

## Cosmetic coordinators

## Support team

## Contact us to learn more about our cosmetic, dermatology and med spa services.

We are experts with over 53 years of combined experience, helping you achieve your skin care goals. If you have concerns about a skin condition, Drs. Joel and Daniel Schlessinger and their expert staff at Schlessinger MD can help.

Consistently voted the best dermatologist and cosmetic surgeon in Omaha, Dr. Schlessinger has more than 25 years of experience treating a wide variety of skin conditions. He can provide expert solutions that are uniquely tailored for your skin.

Dr. Daniel Schlessinger is a board-certified dermatologist, Mohs surgeon and cosmetic surgeon and is dedicated to pioneering innovation with patient-centric approach. Dr. Schlessinger’s unwavering commitment to excellence ensures every patient receives individualized, forward-thinking care, setting new standards in skin health.

Jackie Gaffney is a board-certified Physician Assistant, certified by the National Commission on Certification of Physician Assistants, who has been with Schlessinger MD, formerly known as Skin Specialists, PC, since 1997. She graduated from the University of Nebraska at Kearney with a bachelor’s degree in health science and she completed a master’s degree in physician assistant studies from the University of Nebraska Medical Center.

Shea Perillo is a board-certified Physician Assistant, certified by the National Commission on Certification of Physician Assistants. She graduated with a bachelor of science degree from Mount St. Mary’s College, CA majoring in biology and earned a master’s degree in physicians assistant studies from A.T. Still University, AZ.

Lauren Gerace is a board-certified Physician Assistant, certified by the National Commission on Certification of Physician Assistants. She earned a master’s degree in Physician Assistant Studies from the University of Alabama at Birmingham and holds a bachelor’s degree in Molecular, Cellular, and Developmental Biology from the University of Colorado at Boulder.

We are honored to consistently be named the top Omaha dermatology and cosmetic surgery practice. We appreciate your Best of Omaha vote and promise to continue exceeding your expectations.`;
