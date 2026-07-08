import { upsertContact, upsertPracticeFact } from "@/db/enrich";
import { upsertPractice } from "@/db/ingest";
import type { Database } from "@/db/types";
import { attachSignal, tagVertical } from "@/src/engine/resolver";
import type { VoiceRequest } from "@/src/brief/prompts/voice";
import type { VoiceBrief } from "@/src/brief/schema";

/**
 * The golden practice: a real-shaped dermatology lead with two fired signals, cited
 * firmographics, and a named decision-maker. Seeded through the SAME writers production
 * uses (`upsertPracticeFact`, `attachSignal`, `upsertContact`), so a test exercises the
 * real citation contract — `practice_facts.evidence_id` is NOT NULL, and an uncited fact
 * simply cannot be seeded.
 */

export const DETECTED_AT = new Date("2026-07-01T09:00:00Z");
/** Inside every freshness window (staffing 30d, phone-complaints 90d) at detection + 5 days. */
export const NOW = new Date("2026-07-06T09:00:00Z");

export const ABOUT_URL = "https://schlessinger.example/about";
export const JOB_URL = "https://jobs.example/patient-coordinator-1";
export const REVIEW_URL = "https://reviews.example/place/schlessinger";

export const ABOUT_SNIPPET =
  "Schlessinger MD is a dermatology practice that has served Omaha since 2004.";
export const JOB_SNIPPET =
  "Seeking a patient coordinator to answer phones and manage the appointment schedule for our busy dermatology practice.";
export const REVIEW_SNIPPET = "I could never get through on the phone, always on hold.";

export interface GoldenIds {
  practiceId: string;
  specialtyEvidenceId: string;
  yearFoundedEvidenceId: string;
  staffingEvidenceId: string;
  complaintEvidenceId: string;
}

export interface SeedOptions {
  /** D9's role-only variant — `contacts.name` stays null and nothing invents one. */
  namedContact?: boolean;
  /** Omit both signals to exercise U8's zero-signal brief variant. */
  withSignals?: boolean;
  /** Skip the contact row entirely: a practice with no findable contact at all. */
  withContact?: boolean;
  /** Leave the practice `unclassified` — no pack, so no pitch, so no brief. */
  classify?: boolean;
}

export async function seedGoldenPractice(
  db: Database,
  options: SeedOptions = {},
): Promise<GoldenIds> {
  const {
    namedContact = true,
    withSignals = true,
    withContact = true,
    classify = true,
  } = options;

  const practice = await upsertPractice(db, {
    name: "Schlessinger MD Dermatology",
    geoKey: "omaha-ne",
    city: "Omaha",
    state: "NE",
  });
  if (classify) await tagVertical(db, practice.id, "dermatology");

  const specialty = await upsertPracticeFact(db, {
    practiceId: practice.id,
    provider: "claude_research",
    detectedAt: DETECTED_AT,
    field: "specialty",
    value: "Dermatology",
    sourceUrl: ABOUT_URL,
    snippet: ABOUT_SNIPPET,
  });
  const yearFounded = await upsertPracticeFact(db, {
    practiceId: practice.id,
    provider: "claude_research",
    detectedAt: DETECTED_AT,
    field: "yearFounded",
    value: "2004",
    sourceUrl: ABOUT_URL,
    snippet: ABOUT_SNIPPET,
  });

  if (withContact) {
    await upsertContact(db, {
      practiceId: practice.id,
      role: "Owner Physician",
      name: namedContact ? "Joel Schlessinger" : null,
      email: namedContact ? "joel@schlessinger.example" : null,
      emailProvider: namedContact ? "claude_research" : null,
      linkedinUrl: namedContact ? "https://www.linkedin.com/in/joelschlessinger" : null,
      linkedinProvider: namedContact ? "pdl" : null,
      sourceUrl: ABOUT_URL,
    });
  }

  let staffingEvidenceId = "";
  let complaintEvidenceId = "";
  if (withSignals) {
    const staffing = await attachSignal(db, {
      practiceId: practice.id,
      kind: "staffing_spike",
      sourceUrl: JOB_URL,
      snippet: JOB_SNIPPET,
      confidence: 0.9,
      detectedAt: DETECTED_AT,
      expiresAt: new Date("2026-07-31T09:00:00Z"),
      signalSource: "adzuna",
    });
    const complaint = await attachSignal(db, {
      practiceId: practice.id,
      kind: "phone_complaints",
      sourceUrl: REVIEW_URL,
      snippet: REVIEW_SNIPPET,
      confidence: 0.8,
      detectedAt: DETECTED_AT,
      expiresAt: new Date("2026-09-29T09:00:00Z"),
      signalSource: "google_places",
    });
    staffingEvidenceId = staffing.evidenceId;
    complaintEvidenceId = complaint.evidenceId;
  }

  if (specialty.status !== "written" || yearFounded.status !== "written") {
    throw new Error("golden fixture: facts did not write");
  }

  return {
    practiceId: practice.id,
    specialtyEvidenceId: specialty.evidenceId,
    yearFoundedEvidenceId: yearFounded.evidenceId,
    staffingEvidenceId,
    complaintEvidenceId,
  };
}

/**
 * A brief that passes all three gates, built from whatever evidence ids the request
 * actually carried.
 *
 * Every digit here is grounded: "2004" is the `yearFounded` fact's value, and the CTA's
 * "15 minute call" is the meeting we are proposing, which `lint.ts` exempts by unit and
 * meeting-noun. Nothing else in this prose contains a digit — which is exactly the
 * discipline the prompt asks the real model for.
 */
export function goodVoice(request: VoiceRequest): VoiceBrief {
  const signalId = request.signals[0]?.evidence.id;
  const yearFact = request.facts.find((fact) => fact.field === "yearFounded");
  const citeSignal = signalId ? [signalId] : [];

  return {
    headline: request.zeroSignal ? null : "They are hiring for the front desk right now",
    headlineEvidenceIds: citeSignal,
    callOpener:
      "Your front desk is posting for another phone role. That usually means the phones are winning.",
    callOpenerEvidenceIds: citeSignal,
    personalizationSnippet: yearFact
      ? "You have run this practice in Omaha since 2004."
      : "You have run this practice in Omaha for years.",
    personalizationEvidenceIds: yearFact ? [yearFact.evidence.id] : [],
    sequence: {
      touches: [
        {
          touchNumber: 1,
          channel: "email",
          subject: "Your front desk",
          body: "You are posting for another phone role. Hiring fixes the seat, not the ringing. Worth a look at what happens to the calls that never get answered?",
          evidenceIds: citeSignal,
        },
        {
          touchNumber: 2,
          channel: "call",
          subject: "The calls nobody counts",
          body: "Most practices never see the calls that ring out. Those are the new patients booking down the street.",
          evidenceIds: [],
        },
        {
          touchNumber: 3,
          channel: "email",
          subject: "Closing the loop",
          body: "If the phones are handled, say the word and I will stop. If not, the door stays open.",
          evidenceIds: [],
        },
      ],
      namedCta: "Book a 15 minute call",
    },
    discoveryQuestions: [
      "What happens to a call that rings out at lunch?",
      "Who picks up when the desk is with a patient?",
    ],
    objections: [
      {
        objection: "We already have an answering service",
        rebuttal: "Most do. Ask it what it booked last week.",
      },
      {
        objection: "Patients will hate talking to a robot",
        rebuttal: "They hate hold music more. It books, it does not chat.",
      },
      {
        objection: "We cannot switch systems right now",
        rebuttal: "Nothing changes in your chart. It answers the phone.",
      },
    ],
  };
}
