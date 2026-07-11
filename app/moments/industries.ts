/**
 * Programmatic SEO surface for Channel 2. One templated page per industry at
 * /moments/[slug], each ranking for "buying moments / buying signals in
 * {industry}" long-tail and funneling to a landing experiment. Content is real
 * and specific (genuinely useful, which is what ranks and converts), static, and
 * reads no product data. `variant` is assigned round-robin so the SEO channel
 * also splits evenly across the three experiments.
 */

export type Variant = "saas" | "outbound" | "founders";

export interface Moment {
  title: string;
  why: string;
  where: string;
}

export interface Industry {
  slug: string;
  label: string;
  h1: string;
  intro: string;
  sell: string; // "what you sell to them", for the CTA line
  moments: Moment[];
  variant: Variant;
}

const raw: Omit<Industry, "variant">[] = [
  {
    slug: "b2b-software",
    label: "B2B software",
    h1: "Buying moments in B2B software",
    intro:
      "Software companies leave a loud public trail the moment they are ready to switch or buy. If you sell to revenue, product, or ops teams, these are the signals worth watching.",
    sell: "your product",
    moments: [
      { title: "A vendor sunset or forced migration", why: "When a tool they depend on kills an API or a plan, they have to move on a deadline. Whoever shows up first wins the replacement.", where: "Vendor end-of-life notices, migration job posts, status pages" },
      { title: "A new VP of Sales, RevOps, or CTO", why: "New leaders rebuild the stack in their first quarter. The buying window opens the week they start.", where: "LinkedIn role changes, 8-K Item 5.02, team-page edits" },
      { title: "Hiring for a specific platform", why: "A company posting for a Salesforce admin or a dbt engineer just bought that thing and needs help around it.", where: "Job posts naming the tool or the stack" },
      { title: "A fresh funding round", why: "New money means a mandate to grow and a budget to spend on tools that get them there.", where: "Funding announcements, SEC filings, press" },
    ],
  },
  {
    slug: "dental",
    label: "dental groups",
    h1: "Buying moments in dental",
    intro:
      "Dental groups signal growth and strain in public before they go looking for a fix. If you sell to practices and DSOs, watch for these.",
    sell: "your product",
    moments: [
      { title: "Opening a new location", why: "A new office is the moment scheduling, staffing, and billing stop fitting the old way of doing things.", where: "Location announcements, permits, new-office job posts" },
      { title: "A hiring burst", why: "Several new front-desk or hygienist roles at once means the group is scaling past what it can juggle by hand.", where: "Indeed, LinkedIn, the practice careers page" },
      { title: "A DSO acquisition", why: "When a group is bought or joins a DSO, the whole tool stack gets standardized. New decisions, fast.", where: "Local business press, DSO announcements" },
      { title: "A wave of new patient complaints", why: "A spike in wait-time or billing reviews is fresh pain, and fresh pain is when they finally act.", where: "Google and Yelp review activity" },
    ],
  },
  {
    slug: "agencies",
    label: "agencies",
    h1: "Buying moments for marketing and creative agencies",
    intro:
      "Agencies telegraph new-client wins, growth, and tooling gaps in public. If you sell to agency owners and ops leads, these are the moments.",
    sell: "your product",
    moments: [
      { title: "Landing a big new client", why: "A marquee win means new scope, new headcount, and new tools to deliver it without dropping the ball.", where: "Announcement posts, case studies, press" },
      { title: "Hiring account or ops roles", why: "New account managers and ops hires are how an agency admits it is growing faster than its systems.", where: "LinkedIn and the agency careers page" },
      { title: "A founder or leadership change", why: "A new partner or head of ops reviews how the shop runs, and what it runs on, in the first months.", where: "LinkedIn role changes, team-page edits" },
      { title: "A merger or acquisition", why: "When agencies combine, two tool stacks become one. Every category is suddenly up for grabs.", where: "Industry press, LinkedIn announcements" },
    ],
  },
  {
    slug: "accounting",
    label: "accounting firms",
    h1: "Buying moments for accounting and bookkeeping firms",
    intro:
      "Accounting firms show growth and back-office strain publicly, especially around season and expansion. If you sell to partners and firm admins, watch these.",
    sell: "your product",
    moments: [
      { title: "A hiring push before season", why: "Staffing up for tax or audit season is the moment the firm feels every manual process it has.", where: "Job posts, LinkedIn, the firm careers page" },
      { title: "Opening a second office", why: "Two locations breaks whatever was working for one. Scheduling, files, and billing all get re-decided.", where: "Announcements, permits, local press" },
      { title: "A merger with another firm", why: "Combining books and clients forces a shared system. New decisions across every category.", where: "Industry press, firm announcements" },
      { title: "A new managing partner", why: "New leadership modernizes the firm, and modernizing means new tools in the first year.", where: "LinkedIn role changes, firm news" },
    ],
  },
  {
    slug: "logistics",
    label: "logistics and freight",
    h1: "Buying moments in logistics and freight",
    intro:
      "Logistics companies signal capacity, tech, and growth changes in public. If you sell to ops and supply-chain leaders, these are the windows.",
    sell: "your product",
    moments: [
      { title: "A TMS or WMS migration", why: "When a routing or warehouse platform sunsets or underdelivers, a migration starts, on a clock.", where: "Vendor EOL notices, migration engineer job posts" },
      { title: "Opening a new facility or lane", why: "A new warehouse or route is the moment old tools and processes stop covering the footprint.", where: "Facility announcements, permits, hiring" },
      { title: "A new VP of Operations", why: "New ops leadership audits the stack and the vendors in the first quarter. Everything is on the table.", where: "LinkedIn role changes, press" },
      { title: "A capacity or hiring surge", why: "A burst of driver or dispatcher hiring means volume is outrunning the current setup.", where: "Job-post spikes, LinkedIn" },
    ],
  },
];

// Assign a landing variant round-robin so the SEO channel splits evenly too.
const VARIANTS: Variant[] = ["saas", "outbound", "founders"];
export const INDUSTRIES: Industry[] = raw.map((r, i) => ({ ...r, variant: VARIANTS[i % VARIANTS.length] }));

export const INDUSTRY_SLUGS = INDUSTRIES.map((i) => i.slug);

export function getIndustry(slug: string): Industry | undefined {
  return INDUSTRIES.find((i) => i.slug === slug);
}
