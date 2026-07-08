# Experiment 1 Cohort — Provenance Ledger

Every practice below was verified by fetching a page on the practice's **own website** and counting
the locations that page lists. No practice was contacted; only public pages were read. All checks
performed **2026-07-08**.

| # | Practice | Verification page (where the count was made) | Count recorded | Checked |
|---|----------|----------------------------------------------|----------------|---------|
| 1 | Westlake Dermatology & Cosmetic Surgery | https://www.westlakedermatology.com/contact/ | 22 — the page states verbatim: "We have 22 locations serving the Austin, Houston, Dallas, and San Antonio metro areas." Individual locations sit behind an interactive zip-code finder, so the count is the site's own aggregate statement, not a hand count of a list. | 2026-07-08 |
| 2 | Eye Consultants of Atlanta | https://www.eyeconsultants.net/locations/ | 20 — hand-counted from the locations page list (Buckhead, Piedmont Better Vision, Cumberland, Piedmont Eye, Scottish Rite, Athens consulting, Brookhaven, Fayetteville Adult/Pediatrics/Surgery Center, Lawrenceville Adult/Pediatrics, Macon consulting, Marietta Adult/Pediatrics/Advanced Eye, Newnan Adult/Pediatrics, Peachtree Corners, Stockbridge). Count includes 2 consulting offices and 1 surgery center exactly as the site lists them. | 2026-07-08 |
| 3 | Tennessee Orthopaedic Alliance | https://toa.com/locations (301 from https://toa.com/locations/) | 23 — hand-counted named clinic locations on the locations page (Bellevue, Brentwood, Clarksville, Columbia, Cookeville, Dickson, Franklin, Gallatin, Hendersonville, Lawrenceburg/Ethridge, Lebanon, McMinnville, Mt. Juliet, Murfreesboro, Murfreesboro Westlawn, Nashville-Midtown, Nashville-OneCity, Nolensville, Pleasant View, Smyrna, Spring Hill, Springfield, Waverly). An "Orthopedic Urgent Care" category link on the same page was NOT counted as a location. | 2026-07-08 |
| 4 | Virginia Women's Center | https://virginiawomenscenter.com/contact-us/ | 5 — the page lists 6 entries (Kilmarnock, Mechanicsville, Midlothian, Short Pump, West End, Central Business Office); the Central Business Office states patients are not seen there, so it was excluded. Clinical locations recorded: 5. | 2026-07-08 |
| 5 | Panorama Orthopedics & Spine Center | https://www.panoramaortho.com/locations/ | 4 — orthopedic clinic locations (Centennial, Golden, Highlands Ranch, Westminster). The same page separately lists 9 physical-therapy sites and 9 surgical facilities (mostly third-party hospitals); those were NOT counted as practice locations. | 2026-07-08 |
| 6 | Treasure Valley Dermatology & Skin Cancer Center | https://dermatologyboise.com/locations/ (cross-checked with site footer on https://dermatologyboise.com/) | 2 — the site lists exactly two offices: Eagle Road Office (Meridian) and Curtis Road Office (Boise). Full street addresses are not surfaced in the static page content, but both the locations page and the footer consistently show only these two offices. | 2026-07-08 |
| 7 | Charleston Women's Wellness Center | https://cwwcenter.com/ | 2 — homepage lists both offices with street addresses: 5319 Parkshire Way, Charleston, SC 29418 and 730 Stoney Landing Rd, Moncks Corner, SC 29461. | 2026-07-08 |
| 8 | Milwaukee Orthopaedic Group Limited | https://www.milwaukeeorthopaedics.com/ | 2 — site lists both offices with street addresses: Mequon Office (10586 N. Port Washington Rd., Mequon, WI 53092) and Milwaukee Office (1218 W. Kilbourn Ave., Suite 301, Milwaukee, WI 53233). | 2026-07-08 |
| 9 | Schlessinger MD Dermatology & Cosmetic Surgery | https://www.schlessingermd.com/ | 1 — site shows a single office: 2802 Oak View Drive, Omaha, NE 68144. No other locations listed anywhere on the site. | 2026-07-08 |
| 10 | WNC Ophthalmology, PLLC | https://www.wnceyes.com/contact-us | 1 — contact page lists a single office: 900 Hendersonville Rd., Suite 302, Asheville, NC 28803. Homepage independently describes the practice as a solo, single-office "boutique" clinic. | 2026-07-08 |

## Counting conventions

- Counts are what the practice's own site lists as patient-facing office locations on the cited page,
  on the date checked.
- Explicitly non-clinical entries (admin/business offices) and third-party facilities (hospitals where
  surgeons operate) were excluded; each exclusion is noted in the row.
- Eye Consultants of Atlanta's count (20) is the site's list taken as-is, which mixes full offices,
  consulting offices, and a surgery center — noted here so downstream analysis can re-bucket if needed.

## Candidates passed over / friction log

- **No practice was discarded after fetching its site** — all 10 fetched candidates verified.
  Friction appeared earlier, at the finding stage:
- **Westlake Dermatology**: individual locations hidden behind a JS zip-code finder; had to rely on
  the site's own "22 locations" statement rather than a hand count.
- **WNC Ophthalmology**: no address on the homepage and the guessed `/contact` path 404'd; the real
  page is `/contact-us`. Typical small-practice friction — unstructured sites.
- **Treasure Valley Dermatology**: no street addresses in static page content; count rests on the
  site consistently naming exactly two offices.
- **Total Joint Wisconsin (Dr. Klement, Pewaukee WI)**: passed over — could not quickly establish
  from its site whether it is an independent office or a satellite of a larger group.
- **Lowcountry Women's Specialists (Charleston SC)**: passed over — surfaced only via a chamber-of-
  commerce listing in search, and Charleston was already represented in the cohort.
- **Ada West Dermatology / Idaho Skin Surgery Center (Boise ID)**: passed over — mid-size (3 / 2
  locations); the cohort needed Treasure Valley's cleaner small-practice profile at that slot.

## Orchestrator verification (2026-07-08)

Every URL above was independently re-checked with a plain HTTP client before any paid call.

**First pass — 8× `200`, 2× `403`** (Westlake Dermatology, Eye Consultants of Atlanta), both served by
Cloudflare. I recorded this as a finding: "a meaningful share of practice websites sit behind a WAF."

**That finding was WRONG, and is retracted.** On a second pass — spaced out, and with ordinary
browser request headers — **all 10 sites return `200`, including both that 403'd.** The original 403s
were Cloudflare *rate-limiting a rapid sequential loop over ten domains from one IP*, not a bot wall.
Re-checked with both a default client and a full browser `User-Agent`; both succeed.

**Corrected conclusion:** all 10 cohort sites are readable by our own HTTP client. Website
reachability is **not** a coverage limit for this cohort. What remains true from the original note is
narrower and still worth honoring: a fetch refused by a WAF must be recorded as `blocked`, distinct
from `no data found` — collapsing those two would flatter the hit-rate. It just doesn't happen to
apply to any of these ten.

**Why the retraction is recorded rather than deleted:** the experiment's credibility rests on this
ledger. A finding asserted, then falsified by better evidence, is part of the audit trail.
