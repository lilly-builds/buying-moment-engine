/**
 * Growth-event classifier (U4, R7 precision). Pure — no I/O, no mocks needed to
 * test. Given a news article title, decides whether it describes a PE-deal /
 * acquisition / merger / expansion AND names a healthcare practice — EliseAI's
 * growth wedge: new patient volume outstrips the front desk, or consolidation
 * drives tooling standardization.
 *
 * Precision guard: BOTH signals must be present independently — a growth-event
 * phrase alone (e.g. a PE roundup mentioning no specific practice) never fires,
 * and a bare practice-name mention with no growth-event language (e.g. routine
 * community-health coverage) never fires either. This keeps the detector from
 * emitting on generic industry news or unrelated practice mentions.
 *
 * Practice-name extraction is a bounded heuristic (see `extractPracticeName`):
 * it recognizes a known list of healthcare practice-type nouns (Dental,
 * Veterinary, Dermatology, "Animal Hospital", "Family Practice", etc.) as a
 * name's trailing word(s), then walks backward over adjacent Title-Case words
 * — stopping at a small stoplist of common headline verbs/connectors so it
 * doesn't absorb the acquirer's name or the verb phrase into the hint. It will
 * miss practice names that don't end in a recognized noun and can misfire on
 * unusual headline phrasing; U15 should validate extraction accuracy against a
 * sample of real GDELT titles before trusting `practiceHint` unattended.
 */

export interface GrowthEventClassification {
  isGrowthEvent: boolean;
  /** 0..1; 0 when isGrowthEvent is false. */
  confidence: number;
  practiceHint?: string;
  matchedPhrase?: string;
}

interface GrowthEventPhrase {
  phrase: string;
  confidence: number;
}

/** PE-deal / acquisition / merger / expansion phrases, from the U4 spec. */
const GROWTH_EVENT_PHRASES: GrowthEventPhrase[] = [
  { phrase: "acquired by", confidence: 0.9 },
  { phrase: "acquisition of", confidence: 0.88 },
  { phrase: "acquisition by", confidence: 0.88 },
  { phrase: "acquires", confidence: 0.85 },
  { phrase: "private equity", confidence: 0.85 },
  { phrase: "pe-backed", confidence: 0.8 },
  { phrase: "merges with", confidence: 0.8 },
  { phrase: "merger with", confidence: 0.78 },
  { phrase: "opens second location", confidence: 0.78 },
  { phrase: "opens new location", confidence: 0.75 },
  { phrase: "announces expansion", confidence: 0.75 },
  { phrase: "backed by", confidence: 0.7 },
  { phrase: "expansion into", confidence: 0.7 },
  { phrase: "expands to", confidence: 0.7 },
  { phrase: "growth capital", confidence: 0.68 },
  { phrase: "welcomes new provider", confidence: 0.65 },
  { phrase: "adds new provider", confidence: 0.65 },
  { phrase: "raises funding", confidence: 0.65 },
];

/** Known healthcare practice-type nouns; compounds listed before their overlapping single-word forms. */
const PRACTICE_TYPE_SUFFIXES = [
  "Animal Hospital",
  "Family Practice",
  "Health Partners",
  "Eye Care",
  "Vision Center",
  "Wellness Center",
  "Urgent Care",
  "Physical Therapy",
  "Medical Group",
  "Veterinary Clinic",
  "Women’s Health",
  "Womens Health",
  "Women's Health",
  "Orthopedics",
  "Orthopaedics",
  "Ophthalmology",
  "Retina",
  "Dermatology",
  "Dentistry",
  "Dental",
  "Veterinary",
  "Orthodontics",
  "Optometry",
  "Pediatrics",
  "Chiropractic",
  "Clinic",
];

/** Common headline verbs/connectors that must never be absorbed into a practice name. */
const STOPWORDS = new Set([
  "acquires", "acquired", "acquisition", "announces", "announced",
  "opens", "opened", "merges", "merger", "merged", "expands", "expanded",
  "expansion", "welcomes", "adds", "raises", "backed", "deal", "after",
  "in", "by", "with", "from", "to", "and", "of", "the", "a", "an",
  "new", "second", "regional", "growth", "capital", "raise",
]);

function tokenize(title: string): string[] {
  return title.split(/\s+/).map((t) => t.replace(/[.,:;!?]+$/, ""));
}

function isCapitalized(word: string): boolean {
  return /^[A-Z]/.test(word);
}

/**
 * Pure extraction: title in, best-guess practice name out (or undefined when
 * no recognized practice-type noun is found, or when it isn't preceded by any
 * attributable capitalized word). Picks the left-most suffix match in the
 * title; ties at the same position prefer the longer (compound) suffix.
 */
export function extractPracticeName(title: string): string | undefined {
  const tokens = tokenize(title);
  const lowerTokens = tokens.map((t) => t.toLowerCase());

  let bestMatch: { start: number; length: number } | undefined;
  for (const suffix of PRACTICE_TYPE_SUFFIXES) {
    const suffixWords = suffix.toLowerCase().split(/\s+/);
    for (let i = 0; i <= tokens.length - suffixWords.length; i++) {
      const slice = lowerTokens.slice(i, i + suffixWords.length).join(" ");
      if (slice !== suffixWords.join(" ")) continue;
      if (
        !bestMatch ||
        i < bestMatch.start ||
        (i === bestMatch.start && suffixWords.length > bestMatch.length)
      ) {
        bestMatch = { start: i, length: suffixWords.length };
      }
    }
  }
  if (!bestMatch) return undefined;

  const nameWords: string[] = [];
  let j = bestMatch.start - 1;
  let guard = 0;
  while (j >= 0 && guard < 3) {
    const word = tokens[j];
    if (!isCapitalized(word) || STOPWORDS.has(lowerTokens[j])) break;
    nameWords.unshift(word);
    j--;
    guard++;
  }
  if (nameWords.length === 0) return undefined;

  return [...nameWords, ...tokens.slice(bestMatch.start, bestMatch.start + bestMatch.length)].join(
    " ",
  );
}

/** Pure classification: article title in, verdict + confidence + hint out. */
export function classifyGrowthEvent(title: string): GrowthEventClassification {
  const titleLower = title.toLowerCase();

  let best: GrowthEventPhrase | undefined;
  for (const entry of GROWTH_EVENT_PHRASES) {
    if (titleLower.includes(entry.phrase)) {
      if (!best || entry.confidence > best.confidence) best = entry;
    }
  }
  if (!best) return { isGrowthEvent: false, confidence: 0 };

  const practiceHint = extractPracticeName(title);
  if (!practiceHint) return { isGrowthEvent: false, confidence: 0 };

  return {
    isGrowthEvent: true,
    confidence: best.confidence,
    practiceHint,
    matchedPhrase: best.phrase,
  };
}
