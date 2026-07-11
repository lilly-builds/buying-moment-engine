/**
 * The three landing-page experiments. ONE product ("Buying Moment"), ONE
 * template, three coherent hypotheses. Each variant deliberately moves four
 * levers at once so we learn which whole positioning converts, not which comma:
 *
 *   saas     — niche: B2B software revenue teams | positioning: signal-led
 *              ("catch the switch") | packaging: seats + briefs | pricing: premium
 *   outbound — niche: anyone selling B2B | positioning: outcome-led, plain
 *              ("reach them the moment they need you") | pricing: mid, trial-forward
 *   founders — niche: founders + lean teams | positioning: the AI wedge
 *              ("it learns from your sales calls") | pricing: low, free-first
 *
 * Copy rule for this whole file: NO em dashes anywhere (house rule). Plain
 * English. Every example brief is labelled as an example, never a real claim.
 */

export type VariantKey = "saas" | "outbound" | "founders";

export interface Theme {
  /** Main accent (buttons, links, signal color). */
  accent: string;
  /** Ink that sits on top of the accent (button text). */
  onAccent: string;
  /** Faint accent wash for chips / soft backgrounds. */
  accentSoft: string;
  /** Page ground. */
  ground: string;
  /** Primary text. */
  ink: string;
  /** Muted text. */
  inkMuted: string;
  /** Hairline / border. */
  line: string;
  /** Card surface (sits on ground). */
  card: string;
  /** Dark surface used for the example-brief card + footer. */
  deep: string;
  /** Text on the deep surface. */
  onDeep: string;
  /** Muted text on the deep surface. */
  onDeepMuted: string;
}

export interface Tier {
  name: string;
  price: string;
  cadence: string;
  blurb: string;
  features: string[];
  cta: string;
  highlight?: boolean;
}

export interface BriefExample {
  /** Small caption making clear this is an illustrative example. */
  caption: string;
  company: string;
  meta: string;
  signalLabel: string;
  whyNow: string;
  citations: { label: string; source: string }[];
  contact: { name: string; title: string };
  email: { subject: string; body: string[]; sign: string };
}

export interface VariantConfig {
  key: VariantKey;
  /** Product name is constant across variants so the test isolates positioning. */
  brand: string;
  metaTitle: string;
  metaDescription: string;

  eyebrow: string;
  headline: string;
  headlineAccent: string;
  subhead: string;
  ctaPrimary: string;
  ctaSub: string;
  /** Placeholder for the "what do you sell?" field, tuned to the audience. */
  sellPlaceholder: string;

  proofStats: { big: string; label: string }[];
  proofNote: string;

  stepsIntro: string;
  steps: { n: string; title: string; body: string }[];

  showcaseTitle: string;
  showcaseSub: string;
  brief: BriefExample;

  diffTitle: string;
  diffPoints: { title: string; body: string }[];

  pricingTitle: string;
  pricingSub: string;
  tiers: Tier[];
  pricingFootnote: string;

  guaranteeTitle: string;
  guaranteeBody: string;

  faqTitle: string;
  faqs: { q: string; a: string }[];

  finalTitle: string;
  finalSub: string;

  theme: Theme;
}

const GUARANTEE_SHARED =
  "Every claim in a brief links to the public source it came from. First 3 briefs free, no credit card, no API keys.";

export const VARIANTS: Record<VariantKey, VariantConfig> = {
  // ────────────────────────────────────────────────────────────────────────
  // LP1 — /for/saas — "The Switch"
  // ────────────────────────────────────────────────────────────────────────
  saas: {
    key: "saas",
    brand: "Buying Moment",
    metaTitle: "Buying Moment for B2B software teams — catch accounts the day they're ready to switch",
    metaDescription:
      "Buying Moment watches for the moment a company is ready to switch software, hire for a new stack, or bring in a new decision-maker, then hands your reps the account and the first email, already written and cited.",
    eyebrow: "For B2B software sales and growth teams",
    headline: "Catch companies the moment they",
    headlineAccent: "outgrow their software.",
    subhead:
      "Buying Moment watches the public signals that mean a company is about to switch tools, hire for a new stack, or bring in a new decision-maker. Every weekday morning your reps get the account, the reason it's in-market, and the first email, already written and cited to the source.",
    ctaPrimary: "Get my 3 free briefs",
    ctaSub: "No credit card. No API keys. First 3 accounts on us.",
    sellPlaceholder: "e.g. we sell a modern data warehouse to mid-market ops teams",
    proofStats: [
      { big: "$2,750+", label: "what UserGems charges a month for buying signals" },
      { big: "$2,100", label: "what Common Room runs a month" },
      { big: "from $199", label: "Buying Moment a month, brief and email included" },
    ],
    proofNote:
      "The same intent the enterprise tools sell, plus the brief and the email they make you write yourself, at a fraction of the price.",
    stepsIntro: "From your ICP to your reps' inbox, in three steps and zero setup.",
    steps: [
      {
        n: "01",
        title: "Tell us your ICP",
        body: "Describe who you sell to in plain English, or drop in a few closed-won accounts. Our agent turns it into a live watchlist. No filters to configure, no data warehouse to wire.",
      },
      {
        n: "02",
        title: "We watch the market",
        body: "Every weekday the engine scans public signals: tech-stack changes, vendor sunsets, a new VP landing, hiring for a specific platform. The non-obvious moves your CRM never surfaces.",
      },
      {
        n: "03",
        title: "Your reps get the account, ready to work",
        body: "One brief per company: the buying moment, the decision-maker, the why-now cited to its public source, and a first email your rep can send as-is or tweak.",
      },
    ],
    showcaseTitle: "This is one brief.",
    showcaseSub: "Every claim links to where we found it. Your rep opens it and sends.",
    brief: {
      caption: "Example brief, built for a company that sells a modern TMS platform.",
      company: "Northwind Logistics",
      meta: "Series B · 180 employees · freight software · Chicago",
      signalLabel: "VENDOR SUNSET",
      whyNow:
        "Their current routing platform (Acme TMS) announced end-of-life for its API on March 31. Northwind posted two Integrations Engineer roles tagged TMS migration last week, and their VP of Ops publicly asked peers for modern TMS recommendations. They are shopping, on a clock.",
      citations: [
        { label: "Acme TMS end-of-life notice", source: "acme.com/eol-2026" },
        { label: "2 job posts, TMS migration", source: "LinkedIn Jobs" },
        { label: "VP of Ops asking for recs", source: "LinkedIn post" },
      ],
      contact: { name: "Dana Whitfield", title: "VP of Operations" },
      email: {
        subject: "Acme's API sunset + your two migration hires",
        body: [
          "Hi Dana,",
          "Saw Acme is sunsetting its TMS API at the end of March, and that you're already hiring two engineers for the migration. That is a tight clock.",
          "Lanefox is a modern TMS built for teams moving off Acme. Most of the migration you're staffing for, we handle inside the platform, so your two new hires build instead of firefight.",
          "Worth 15 minutes before you commit to the next platform? I can send an Acme vs Lanefox side-by-side first.",
        ],
        sign: "— Sam, Lanefox",
      },
    },
    diffTitle: "Not another intent feed.",
    diffPoints: [
      {
        title: "The last mile, done",
        body: "Everyone sells you a list. We hand you the brief and the first email, written and cited. Your rep opens it and sends.",
      },
      {
        title: "The signals a filter misses",
        body: "Vendor sunsets, forced migrations, a company hiring for the exact tool they just bought. Timing a keyword search can't catch.",
      },
      {
        title: "Every claim has a receipt",
        body: "Each why-now links to the public source it came from, so your rep sounds informed, never like they're guessing.",
      },
      {
        title: "Zero setup",
        body: "No API keys, no Clay tables, no RevOps ticket. Describe your buyer, get accounts tomorrow morning.",
      },
    ],
    pricingTitle: "Priced for a team, not an enterprise.",
    pricingSub: "The tools that write the brief for you start at $2,000 a month. This starts at $199.",
    tiers: [
      {
        name: "Starter",
        price: "$199",
        cadence: "/mo",
        blurb: "For a founder or first rep testing the waters.",
        features: ["40 briefs a month", "1 seat", "All signal types", "Cited source on every claim"],
        cta: "Start with 3 free",
      },
      {
        name: "Growth",
        price: "$499",
        cadence: "/mo",
        blurb: "For a sales team that wants pipeline every morning.",
        features: ["150 briefs a month", "3 seats", "HubSpot and Salesforce push", "Priority signals"],
        cta: "Start with 3 free",
        highlight: true,
      },
      {
        name: "Team",
        price: "$999",
        cadence: "/mo",
        blurb: "For a full revenue org running on buying moments.",
        features: ["500 briefs a month", "Unlimited seats", "Custom watchlists", "Shared send inbox"],
        cta: "Talk to us",
      },
    ],
    pricingFootnote:
      "A brief = one company at a buying moment, plus the decision-maker, the cited why-now, and a ready email. Extra briefs $1 each. Annual saves two months.",
    guaranteeTitle: "Find 3 real buying moments in your first week, or you don't pay.",
    guaranteeBody:
      "If the accounts we send aren't genuinely in-market, tell us inside 14 days and we refund every cent. You keep the briefs. " +
      GUARANTEE_SHARED,
    faqTitle: "The usual questions.",
    faqs: [
      {
        q: "How is this different from Apollo or ZoomInfo?",
        a: "Those hand you contacts and let you filter by firmographics. We watch for the moment a specific company is actually in-market for what you sell, then write the brief and the email. Different job.",
      },
      {
        q: "Do I need to connect anything technical?",
        a: "No. No API keys, no data warehouse, no Clay tables. Describe your buyer in a chat and you get accounts the next morning.",
      },
      {
        q: "Where does the data come from?",
        a: "Public signals: job posts, filings, product and pricing pages, exec changes, vendor announcements. Every claim in a brief links to its source.",
      },
      {
        q: "What if a signal is wrong?",
        a: "Every brief shows its receipts so your rep can check before reaching out. And the guarantee covers you.",
      },
      {
        q: "Can it push to my CRM?",
        a: "Yes, HubSpot and Salesforce on Growth and up. Or work straight from the feed.",
      },
    ],
    finalTitle: "See the accounts you're missing this week.",
    finalSub: "Your first 3 briefs are free. No card, no setup, five minutes.",
    theme: {
      accent: "#4f46e5",
      onAccent: "#ffffff",
      accentSoft: "#eef1fe",
      ground: "#ffffff",
      ink: "#0b1020",
      inkMuted: "#5b6472",
      line: "#e6e8f2",
      card: "#f7f8fc",
      deep: "#0a0f24",
      onDeep: "#f4f6ff",
      onDeepMuted: "#9aa3c7",
    },
  },

  // ────────────────────────────────────────────────────────────────────────
  // LP2 — /for/outbound — "The Moment"
  // ────────────────────────────────────────────────────────────────────────
  outbound: {
    key: "outbound",
    brand: "Buying Moment",
    metaTitle: "Buying Moment — stop cold emailing. Reach them the moment they need you.",
    metaDescription:
      "Tell us what you sell. Every morning Buying Moment hands you a short list of companies that just hit a buying moment for it, each with the person to email and the email already written.",
    eyebrow: "For anyone who sells to other businesses",
    headline: "Stop cold emailing strangers.",
    headlineAccent: "Reach them the moment they need you.",
    subhead:
      "Tell us what you sell. Every morning you get a short list of companies that just hit a buying moment for it, each with the right person to email and the email already written. You just hit send.",
    ctaPrimary: "Get my 3 free briefs",
    ctaSub: "Free to start. No credit card. No setup.",
    sellPlaceholder: "e.g. we sell scheduling software to dental groups",
    proofStats: [
      { big: "Every weekday", label: "a fresh, short list lands in your inbox" },
      { big: "Every claim", label: "linked to where we found it in public" },
      { big: "5 minutes", label: "to set up, no tech and no card needed" },
    ],
    proofNote:
      "It's the difference between hi, do you need this and hi, I saw you just started needing this.",
    stepsIntro: "No lists to build. No tools to learn. Three steps and you're done.",
    steps: [
      {
        n: "01",
        title: "Tell us what you sell",
        body: "One sentence is enough. We sell payroll software to restaurants. Or drop in a few of your best past customers and we'll spot the pattern.",
      },
      {
        n: "02",
        title: "We find who needs it right now",
        body: "Every morning we scan the public web for companies showing the signs they need what you sell, today. Not a giant list. A short, hot one.",
      },
      {
        n: "03",
        title: "You send the email we wrote",
        body: "Each company comes with the person to contact, the reason now is the moment, and a ready-to-send email. Send it as-is or make it yours.",
      },
    ],
    showcaseTitle: "This is one brief.",
    showcaseSub: "The company, why now is the moment, who to email, and the email. All of it.",
    brief: {
      caption: "Example brief, built for a company that sells scheduling software to dental groups.",
      company: "Sunbelt Dental Group",
      meta: "3 clinics · Phoenix, AZ · opening a 4th",
      signalLabel: "GROWING FAST",
      whyNow:
        "Sunbelt just announced a fourth location opening in June and posted six new front-desk and hygienist roles this month. A group growing this fast is the moment they start feeling the pain you solve, before they've gone looking for a fix.",
      citations: [
        { label: "Now open: 4th location post", source: "Facebook" },
        { label: "6 new job posts", source: "Indeed" },
        { label: "New location permit filed", source: "City of Phoenix" },
      ],
      contact: { name: "Marcus Lee", title: "Operations Director" },
      email: {
        subject: "Congrats on location #4, one thing that gets harder at 4 clinics",
        body: [
          "Hi Marcus,",
          "Saw Sunbelt is opening a fourth location in June, congrats. Four clinics is usually where juggling schedules across sites stops working on spreadsheets.",
          "Chairside keeps every location's book in one place, so front desks stop double-booking and your hygienists stay full. Groups your size usually claw back a few hours a week per clinic.",
          "Want a 2-minute example from a similar 4-location group?",
        ],
        sign: "— Riley, Chairside",
      },
    },
    diffTitle: "Why this actually works.",
    diffPoints: [
      {
        title: "You reach out at the right moment",
        body: "Not someday maybe, but the week they started needing you. That's the whole game.",
      },
      {
        title: "The email is already written",
        body: "The hardest part of outbound is the blank page. We hand you a full draft that says exactly why you're reaching out.",
      },
      {
        title: "You sound like you did your homework",
        body: "Because we did. Every message points to a real, recent, public reason they'd want to hear from you.",
      },
      {
        title: "Nothing to set up",
        body: "No lists to build, no tools to learn, no credit card to start. Tell us what you sell and check your inbox tomorrow.",
      },
    ],
    pricingTitle: "Start free. Pay when it's working.",
    pricingSub: "Three briefs on us, no card. If they're good, you stay.",
    tiers: [
      {
        name: "Free",
        price: "$0",
        cadence: "",
        blurb: "See it work before you pay a cent.",
        features: ["3 briefs now, then 3 a month", "No credit card", "The full brief and email", "Cancel is not even a thing"],
        cta: "Get 3 free briefs",
      },
      {
        name: "Solo",
        price: "$99",
        cadence: "/mo",
        blurb: "For one person who wants a full inbox.",
        features: ["50 briefs a month", "1 sending inbox", "Every claim cited", "Send from the feed"],
        cta: "Start with 3 free",
        highlight: true,
      },
      {
        name: "Pro",
        price: "$299",
        cadence: "/mo",
        blurb: "For a small team splitting the load.",
        features: ["200 briefs a month", "3 teammates", "Push to your CRM", "Priority support"],
        cta: "Start with 3 free",
      },
    ],
    pricingFootnote:
      "A brief = one company that needs you right now, the person to email, and the email itself. Cancel anytime. Extra briefs $1 each.",
    guaranteeTitle: "3 companies worth emailing in your first week, or you pay nothing.",
    guaranteeBody:
      "If your first week doesn't turn up three companies genuinely worth reaching out to, you pay nothing and keep the briefs. Simple. " +
      GUARANTEE_SHARED,
    faqTitle: "Fair questions.",
    faqs: [
      {
        q: "Is this just another lead list?",
        a: "No. A list is a pile of names. We hand you a few companies that need you this week, why they need you, and the email to send. The work is done.",
      },
      {
        q: "What kinds of businesses does it work for?",
        a: "Anything you sell to other businesses: software, services, agencies, suppliers. If your customers leave a public trail when they grow or hurt, we can catch it.",
      },
      {
        q: "Do I have to write anything?",
        a: "No. Every company comes with a full draft email. Read it, hit send, or change a line first. Your call.",
      },
      {
        q: "How much time does it take?",
        a: "About five minutes to tell us what you sell. After that, a few minutes a morning to send the ones you like.",
      },
      {
        q: "Is it really free to start?",
        a: "Yes. Three briefs, no credit card. If they're good, you stay.",
      },
    ],
    finalTitle: "Tomorrow morning, get a list of people who want to hear from you.",
    finalSub: "Three free briefs. No card. Tell us what you sell and see.",
    theme: {
      accent: "#d24a17",
      onAccent: "#ffffff",
      accentSoft: "#fbeadd",
      ground: "#fbf9f6",
      ink: "#1c1917",
      inkMuted: "#6b6560",
      line: "#ece6dd",
      card: "#ffffff",
      deep: "#211a14",
      onDeep: "#faf6f0",
      onDeepMuted: "#c3b6a6",
    },
  },

  // ────────────────────────────────────────────────────────────────────────
  // LP3 — /for/founders — "The Autopilot"
  // ────────────────────────────────────────────────────────────────────────
  founders: {
    key: "founders",
    brand: "Buying Moment",
    metaTitle: "Buying Moment — your AI prospecting researcher. Feed it your sales calls.",
    metaDescription:
      "Buying Moment listens to how you sell, learns exactly who your buyer is, then hunts the market every night and hands you tomorrow's leads, already written. No SDR, no researcher, no API keys.",
    eyebrow: "For founders and lean teams selling B2B",
    headline: "Feed it your best sales calls.",
    headlineAccent: "Wake up to tomorrow's leads, already written.",
    subhead:
      "Buying Moment listens to how you actually sell, learns exactly who your buyer is and what makes them ready, then hunts the market for more of them every night. You wake up to a short list, each with the person to email and the email drafted. No SDR. No researcher. No blank page.",
    ctaPrimary: "Start free, no card",
    ctaSub: "3 briefs on us. Set up in one sitting. No API keys, ever.",
    sellPlaceholder: "e.g. we sell a RevOps analytics tool to Series A startups",
    proofStats: [
      { big: "5 calls in", label: "it knows your buyer better than a new hire" },
      { big: "Every night", label: "it finds more of them while you sleep" },
      { big: "$0 to start", label: "3 briefs free, no credit card" },
    ],
    proofNote:
      "The researcher, the list, and the first email. The three jobs you never have time for, done by morning.",
    stepsIntro: "The part no other tool does: it learns your buyer from how you already sell.",
    steps: [
      {
        n: "01",
        title: "Drop in a few sales calls, or just chat",
        body: "Upload a handful of recordings or transcripts, or talk to our agent for five minutes. It learns who buys from you and the exact moment they get ready. This is the part no other tool does.",
      },
      {
        n: "02",
        title: "It builds your buyer, you approve it",
        body: "You get a plain-English profile: who to chase, what signals mean now, what to say. One click to tweak. No filters, no config, no keys.",
      },
      {
        n: "03",
        title: "It hunts while you sleep",
        body: "Every night it scans the public web for companies hitting that moment and drafts the outreach. You wake up to a short list you can send in minutes.",
      },
    ],
    showcaseTitle: "You wake up to this.",
    showcaseSub: "Found overnight, written for you, cited so you can trust it before you send.",
    brief: {
      caption: "Example brief, built for a company that sells RevOps analytics.",
      company: "Ridgeline HR",
      meta: "Seed stage · 40 employees · HR software · Denver",
      signalLabel: "NEW DECISION-MAKER",
      whyNow:
        "Ridgeline just hired a Head of Revenue Operations, announced on LinkedIn six days ago. A brand-new RevOps leader spends their first 90 days ripping out tools that don't work and buying ones that do. Your window is now, while they're still deciding.",
      citations: [
        { label: "New Head of RevOps announced", source: "LinkedIn" },
        { label: "RevOps added to team page", source: "ridgeline.com/team" },
      ],
      contact: { name: "Priya Nair", title: "Head of Revenue Operations" },
      email: {
        subject: "Congrats on the new role, one thing worth a look in your first 90 days",
        body: [
          "Hi Priya,",
          "Congrats on the RevOps role at Ridgeline. The first months are usually when you decide what stays and what goes.",
          "Northstar gives new RevOps leaders a clean read on pipeline and forecast without a rip-and-replace, so you can show a win before your first QBR.",
          "If it's on your list, I can send a 3-minute teardown of how a team your size set it up. No pitch if the timing is off.",
        ],
        sign: "— Jordan, Northstar",
      },
    },
    diffTitle: "Built for people with no time and no team.",
    diffPoints: [
      {
        title: "It learns from how you already sell",
        body: "Your sales calls are the best description of your buyer that exists. It listens and copies your instincts, so you're not filling out forms.",
      },
      {
        title: "It does the three jobs you skip",
        body: "The research, the finding, the first draft. Your pipeline isn't thin from lack of effort, it's thin from lack of hours. This gives them back.",
      },
      {
        title: "You keep your mornings",
        body: "It works overnight. You wake up to a short, ready list, not another tool you have to go operate.",
      },
      {
        title: "Nothing to configure, ever",
        body: "No API keys, no integrations degree, no setup weekend. It runs on our accounts, not yours.",
      },
    ],
    pricingTitle: "Cheaper than a coffee habit. Way cheaper than an SDR.",
    pricingSub: "Start free. Upgrade when it's already paying for itself.",
    tiers: [
      {
        name: "Free",
        price: "$0",
        cadence: "",
        blurb: "Prove it to yourself first.",
        features: ["3 briefs, no card", "Keep them forever", "The full brief and email", "Set up in one sitting"],
        cta: "Start free",
      },
      {
        name: "Founder",
        price: "$79",
        cadence: "/mo",
        blurb: "For the one person doing everything.",
        features: ["40 briefs a month", "Learns from your calls", "1 sending inbox", "Every claim cited"],
        cta: "Start free",
        highlight: true,
      },
      {
        name: "Team",
        price: "$199",
        cadence: "/mo",
        blurb: "For a small team that wants to move.",
        features: ["120 briefs a month", "3 seats", "Push to your CRM", "Priority support"],
        cta: "Start free",
      },
    ],
    pricingFootnote:
      "A brief = one company at its buying moment, the person to email, and the email drafted. Cancel anytime. Extra briefs $1 each.",
    guaranteeTitle: "3 real leads in your first week, or you pay nothing.",
    guaranteeBody:
      "Set it up, and if it doesn't hand you three real leads worth emailing in your first week, you pay nothing and keep them. You risk five minutes. " +
      GUARANTEE_SHARED,
    faqTitle: "What founders ask.",
    faqs: [
      {
        q: "I don't have sales calls recorded. Can I still use it?",
        a: "Yes. Talk to the agent for five minutes instead and it learns the same way. Calls just make it sharper, faster.",
      },
      {
        q: "Is my call data safe?",
        a: "Your recordings are used only to learn your buyer profile, never shared, and you can delete them anytime. We only need a few.",
      },
      {
        q: "Do I need to be technical?",
        a: "Not at all. There are no API keys and nothing to connect. It runs on our accounts and hands you finished work.",
      },
      {
        q: "How is this different from hiring an SDR?",
        a: "An SDR costs thousands a month and ramps for a quarter. This ramps in five minutes, works every night, and starts free.",
      },
      {
        q: "What if I sell something unusual?",
        a: "That is exactly what the call-learning is for. It builds your buyer from your reality, not a template.",
      },
    ],
    finalTitle: "Go to sleep. Wake up to leads.",
    finalSub: "Feed it a few calls, get 3 briefs free, see what it finds tonight.",
    theme: {
      accent: "#0d9488",
      onAccent: "#ffffff",
      accentSoft: "#e2f6f2",
      ground: "#ffffff",
      ink: "#0c1a18",
      inkMuted: "#586a67",
      line: "#e2ecea",
      card: "#f3faf8",
      deep: "#0a1a17",
      onDeep: "#effbf8",
      onDeepMuted: "#8fb8b0",
    },
  },
};

export const VARIANT_KEYS = Object.keys(VARIANTS) as VariantKey[];

export function isVariantKey(v: string): v is VariantKey {
  // Own-property check only: `v in VARIANTS` would also match inherited keys like
  // "constructor" / "toString". Guarded today by dynamicParams=false, but correct
  // regardless of how the route is configured later.
  return Object.prototype.hasOwnProperty.call(VARIANTS, v);
}
