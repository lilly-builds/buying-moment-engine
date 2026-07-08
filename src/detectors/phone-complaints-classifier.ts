/**
 * Phone-access complaint classifier (U4, R7 precision). Pure — no I/O, no
 * mocks needed to test. Given a single review's text, decides whether it
 * names an ACUTE, self-reported phone-access failure: EliseAI's exact wedge
 * is a practice whose phones can't keep up with call volume, the pain its AI
 * receptionist solves.
 *
 * Precision guard: match against a closed vocabulary of specific multi-word
 * complaint phrases — never a single ambiguous word like "phone" or "hold"
 * on its own — so a review that merely mentions the phone positively (e.g.
 * "I called and the staff were lovely") never flags.
 *
 * `category` is OUR OWN closed-vocabulary label, never a verbatim excerpt of
 * the review. The Google-path evidence (see `phone-complaints-google-places.ts`)
 * persists only this category, never the review's own words — the mechanism
 * that honors the source's no-store-review-text rule documented in
 * `phone-complaints.recon.md`.
 */

interface PhoneComplaintPhrase {
  /** Substring matched against the lowercased review text (not persisted). */
  phrase: string;
  /** Closed-vocabulary label — safe to persist on any source, incl. Google. */
  category: string;
  confidence: number;
}

/** Phone-complaint phrases, from the U4 spec's own examples plus variants. */
const PHONE_COMPLAINT_PHRASES: PhoneComplaintPhrase[] = [
  { phrase: "can't get through", category: "cannot-get-through", confidence: 0.9 },
  { phrase: "cant get through", category: "cannot-get-through", confidence: 0.9 },
  { phrase: "impossible to reach by phone", category: "cannot-get-through", confidence: 0.9 },
  { phrase: "impossible to reach", category: "cannot-get-through", confidence: 0.8 },
  { phrase: "no one ever answers the phone", category: "no-answer", confidence: 0.9 },
  { phrase: "no one answers the phone", category: "no-answer", confidence: 0.9 },
  { phrase: "nobody answers the phone", category: "no-answer", confidence: 0.85 },
  { phrase: "never answers the phone", category: "no-answer", confidence: 0.85 },
  { phrase: "phone rings and rings", category: "no-answer", confidence: 0.85 },
  { phrase: "rings and rings", category: "no-answer", confidence: 0.8 },
  { phrase: "on hold forever", category: "long-hold", confidence: 0.85 },
  { phrase: "always on hold", category: "long-hold", confidence: 0.85 },
  { phrase: "left on hold", category: "long-hold", confidence: 0.85 },
  { phrase: "put on hold and forgotten", category: "long-hold", confidence: 0.8 },
];

export interface PhoneComplaintClassification {
  isPhoneComplaint: boolean;
  /** 0..1; 0 when isPhoneComplaint is false. */
  confidence: number;
  /** Closed-vocabulary category — never a verbatim excerpt of the review. */
  category?: string;
}

/** Pure classification: review text in, verdict + confidence + category out. */
export function classifyPhoneComplaint(text: string): PhoneComplaintClassification {
  const haystack = text.toLowerCase();

  let best: PhoneComplaintPhrase | undefined;
  for (const entry of PHONE_COMPLAINT_PHRASES) {
    if (haystack.includes(entry.phrase)) {
      if (!best || entry.confidence > best.confidence) best = entry;
    }
  }

  if (!best) return { isPhoneComplaint: false, confidence: 0 };
  return { isPhoneComplaint: true, confidence: best.confidence, category: best.category };
}
