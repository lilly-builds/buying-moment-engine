/**
 * Front-desk role classifier (U4, R7 precision). Pure — no I/O, no mocks
 * needed to test. Given a job title/description, decides whether it names a
 * front-desk / phone / patient-access role (EliseAI's exact wedge: a practice
 * that can't keep up with call volume hires for these titles first).
 *
 * Precision guard: a CLINICAL role (RN, medical assistant, nurse
 * practitioner, etc.) never counts as a front-desk hit, even if its
 * description happens to mention phones or scheduling — the exclusion check
 * runs against the TITLE only, since the title unambiguously names the role
 * being hired for. This avoids false negatives from a legitimate front-desk
 * posting whose description mentions clinical coworkers (e.g. "supports our
 * Nurse Practitioner").
 */

interface FrontDeskPhrase {
  phrase: string;
  confidence: number;
}

/** Front-desk / phone / patient-access phrases, from the U4 spec. */
const FRONT_DESK_PHRASES: FrontDeskPhrase[] = [
  { phrase: "front desk", confidence: 0.9 },
  { phrase: "front-desk", confidence: 0.9 },
  { phrase: "receptionist", confidence: 0.9 },
  { phrase: "patient coordinator", confidence: 0.85 },
  { phrase: "patient access", confidence: 0.85 },
  { phrase: "appointment coordinator", confidence: 0.8 },
  { phrase: "call center", confidence: 0.8 },
  { phrase: "call centre", confidence: 0.8 },
  { phrase: "phone operator", confidence: 0.75 },
  { phrase: "scheduler", confidence: 0.75 },
];

/** Clinical role titles that must NEVER count as a front-desk hit. */
const CLINICAL_EXCLUSION_PHRASES: string[] = [
  "registered nurse",
  "nurse practitioner",
  "medical assistant",
  "physician assistant",
  "dental hygienist",
  "veterinary technician",
  "vet tech",
  "physical therapist",
  "phlebotomist",
  "pharmacist",
];

export interface FrontDeskClassification {
  isFrontDesk: boolean;
  /** 0..1; 0 when isFrontDesk is false. */
  confidence: number;
  matchedPhrase?: string;
}

/** Pure classification: title/description in, verdict + confidence out. */
export function classifyFrontDeskRole(
  title: string,
  description = "",
): FrontDeskClassification {
  const titleLower = title.toLowerCase();

  for (const clinicalPhrase of CLINICAL_EXCLUSION_PHRASES) {
    if (titleLower.includes(clinicalPhrase)) {
      return { isFrontDesk: false, confidence: 0 };
    }
  }

  const haystack = `${title} ${description}`.toLowerCase();
  let best: FrontDeskPhrase | undefined;
  for (const entry of FRONT_DESK_PHRASES) {
    if (haystack.includes(entry.phrase)) {
      if (!best || entry.confidence > best.confidence) best = entry;
    }
  }

  if (!best) return { isFrontDesk: false, confidence: 0 };
  return { isFrontDesk: true, confidence: best.confidence, matchedPhrase: best.phrase };
}
