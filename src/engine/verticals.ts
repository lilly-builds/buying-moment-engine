import { PACK_VERTICALS, getAllPacks, type PackVertical } from "@/src/packs";

/**
 * Vertical classification (U5, R6) — PURE: no I/O, no DB, unit-testable with no
 * mocks. Two signals, in strict precedence:
 *
 *   1. SPECIALTY KEYWORDS — the practice's own words (name, specialty text,
 *      service lines). Strongest signal; a derm practice says "dermatology".
 *   2. EHR-AS-SIGNAL — drawn from the authored packs (`src/packs/*.ehrSignals`),
 *      used ONLY as a tiebreak/fallback and ONLY when the EHR maps to exactly
 *      one vertical. ModMed and Nextech each ship suites for dermatology,
 *      ophthalmology AND orthopedics, so "runs ModMed" tells you nothing about
 *      which — treating it as evidence would misfile. Phoenix Ortho (orthopedics)
 *      and digiChart (OB-GYN) are single-vertical, so they do classify.
 *
 * Anything the two signals can't resolve is `unclassified`. That is a real,
 * honest state — NOT a default bucket: `isFeedEligible` keeps it out of the feed
 * (see `db/queries.ts#feedPractices`) rather than guessing a vertical and
 * shipping an AE the wrong pitch.
 */

export const UNCLASSIFIED = "unclassified" as const;

export type Vertical = PackVertical | typeof UNCLASSIFIED;

export interface ClassificationInput {
  /** Practice name, specialty line, service lines — whatever public text we have. */
  text: string;
  /** Incumbent EHR, if research found one. Used only as the fallback signal. */
  ehr?: string | null;
}

export type ClassificationReason =
  | "specialty_keywords"
  | "ehr_signal"
  | "no_signal"
  | "ambiguous_specialty"
  | "ambiguous_ehr";

export interface Classification {
  vertical: Vertical;
  reason: ClassificationReason;
  /** The keyword(s) or EHR name that drove the verdict — never an opaque id. */
  matched: string[];
}

/**
 * Specialty keywords per vertical. Hand-authored (like the packs) rather than
 * derived, because the sharp edges matter: "ob" alone is too short to match
 * safely, "eye care" must beat a bare "care", and "sports medicine" is orthopedic
 * only in combination.
 */
const SPECIALTY_KEYWORDS: Record<PackVertical, readonly string[]> = {
  dermatology: [
    "dermatology",
    "dermatologist",
    "dermatologic",
    "skin cancer",
    "skin care center",
    "mohs",
    "cosmetic dermatology",
  ],
  womens_health: [
    "womens health",
    "women's health",
    "obgyn",
    "ob gyn",
    "ob-gyn",
    "obstetrics",
    "gynecology",
    "gynecologic",
    "midwifery",
    "maternal fetal medicine",
  ],
  ophthalmology: [
    "ophthalmology",
    "ophthalmologist",
    "ophthalmic",
    "eye care",
    "eye institute",
    "eye associates",
    "retina",
    "cataract",
    "lasik",
  ],
  orthopedics: [
    "orthopedics",
    "orthopaedics",
    "orthopedic",
    "orthopaedic",
    "sports medicine",
    "joint replacement",
    "spine institute",
    "hand surgery",
  ],
};

/** Lowercase, strip punctuation to spaces, collapse whitespace. */
export function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * EHR name -> the verticals whose pack lists it. Built from the authored packs so
 * a new pack's EHR list is picked up with no code change (U7's "packs as data").
 * Names are normalized and split on "/" (a pack may list "digiChart / digi2.0").
 */
function buildEhrIndex(): Map<string, Set<PackVertical>> {
  const index = new Map<string, Set<PackVertical>>();
  const packs = getAllPacks();
  for (const vertical of PACK_VERTICALS) {
    for (const signal of packs[vertical].ehrSignals) {
      // "ModMed EMA (Dermatology)" -> "modmed ema"; drop the parenthetical, which
      // names the vertical rather than the product.
      const withoutParens = signal.name.replace(/\([^)]*\)/g, " ");
      for (const alternative of withoutParens.split("/")) {
        const key = normalizeText(alternative);
        if (!key) continue;
        const set = index.get(key) ?? new Set<PackVertical>();
        set.add(vertical);
        index.set(key, set);
      }
    }
  }
  return index;
}

let ehrIndexCache: Map<string, Set<PackVertical>> | null = null;

function ehrIndex(): Map<string, Set<PackVertical>> {
  ehrIndexCache ??= buildEhrIndex();
  return ehrIndexCache;
}

/**
 * Which verticals does this EHR imply? A product name matches a pack entry when
 * either contains the other ("ModMed" matches "modmed ema"), so an observed name
 * that is vaguer than the pack's still surfaces every vertical it could mean —
 * which is exactly what makes it ambiguous, and therefore unusable.
 */
export function verticalsForEhr(ehr: string): PackVertical[] {
  const observed = normalizeText(ehr);
  if (!observed) return [];
  const hits = new Set<PackVertical>();
  for (const [key, verticals] of ehrIndex()) {
    if (observed === key || observed.includes(key) || key.includes(observed)) {
      for (const v of verticals) hits.add(v);
    }
  }
  return [...hits].sort();
}

function matchSpecialty(text: string): {
  verticals: PackVertical[];
  matched: string[];
} {
  const haystack = normalizeText(text);
  const hits = new Set<PackVertical>();
  const matched: string[] = [];
  for (const vertical of PACK_VERTICALS) {
    for (const keyword of SPECIALTY_KEYWORDS[vertical]) {
      const needle = normalizeText(keyword);
      if (needle && haystack.includes(needle)) {
        hits.add(vertical);
        matched.push(keyword);
      }
    }
  }
  return { verticals: [...hits].sort(), matched };
}

/**
 * Classify a practice. Specialty keywords win; a single-vertical EHR is the
 * fallback; everything else is `unclassified` with the reason recorded so the
 * miss is debuggable instead of invisible.
 */
export function classifyVertical(input: ClassificationInput): Classification {
  const specialty = matchSpecialty(input.text);
  if (specialty.verticals.length === 1) {
    return {
      vertical: specialty.verticals[0],
      reason: "specialty_keywords",
      matched: specialty.matched,
    };
  }

  const ehrVerticals = input.ehr ? verticalsForEhr(input.ehr) : [];

  // Multi-specialty text (e.g. a group listing both dermatology and ophthalmology):
  // a single-vertical EHR can break the tie, but only if it names one of the
  // candidates already in the text. Otherwise we'd let the EHR overrule the
  // practice's own words.
  if (specialty.verticals.length > 1) {
    if (
      ehrVerticals.length === 1 &&
      specialty.verticals.includes(ehrVerticals[0])
    ) {
      return {
        vertical: ehrVerticals[0],
        reason: "ehr_signal",
        matched: [...specialty.matched, input.ehr ?? ""].filter(Boolean),
      };
    }
    return {
      vertical: UNCLASSIFIED,
      reason: "ambiguous_specialty",
      matched: specialty.matched,
    };
  }

  if (ehrVerticals.length === 1) {
    return {
      vertical: ehrVerticals[0],
      reason: "ehr_signal",
      matched: [input.ehr ?? ""].filter(Boolean),
    };
  }
  if (ehrVerticals.length > 1) {
    return {
      vertical: UNCLASSIFIED,
      reason: "ambiguous_ehr",
      matched: [input.ehr ?? ""].filter(Boolean),
    };
  }

  return { vertical: UNCLASSIFIED, reason: "no_signal", matched: [] };
}

/**
 * Feed eligibility (R6). The DB mirror of this rule lives in
 * `db/queries.ts#feedPractices`; keep the two in step.
 */
export function isFeedEligible(vertical: Vertical | string): boolean {
  return vertical !== UNCLASSIFIED;
}
