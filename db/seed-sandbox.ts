import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Database } from "./types";
import { upsertPractice, upsertSignal } from "./ingest";
import { briefs, contacts, evidence, sequences } from "./schema";
import { BRIEF_SCHEMA_VERSION } from "@/src/brief/config";
import { demoBrief } from "@/app/styleguide/demo-fixtures";

/**
 * The D9 SANDBOX test lead (U11) — the one practice whose contact address the send
 * firewall allows, so the live email-send path can be proven end-to-end without ever
 * touching a real practice.
 *
 * It is a demo/sandbox practice like Cedarline (a `demo:` geo-key prefix, fictional
 * name, `example` citation URLs), which is exactly what `src/send/send-brief.ts`
 * classifies as `sandbox` — the INDEPENDENT half of the D9 firewall, on top of the
 * address allowlist (`SEND_SANDBOX_EMAILS`). Its contact address is
 * `hellolillyfield@gmail.com`, the one registered sandbox inbox.
 *
 * Kept OUT of `seedDemo` on purpose: the scoreboard integration test asserts exact
 * funnel totals over the demo dataset, and this lead has no funnel/ROI rows — it is
 * a send fixture, not a showcase practice. Seed it with `pnpm db:seed:sandbox`.
 *
 * Idempotent + non-destructive (same contract as `db/seed-demo.ts`): every write is
 * keyed and `ON CONFLICT DO NOTHING`, so a second run changes nothing.
 */

const SANDBOX_GEO_KEY = "demo:sandbox-lilly";
const SANDBOX_PRACTICE_NAME = "Sandbox Test Practice (Lilly)";
const SANDBOX_CONTACT_EMAIL = "hellolillyfield@gmail.com";
const SANDBOX_CONTACT_NAME = "Lilly Field";

function seedId(key: string): string {
  const h = createHash("sha1").update(`bme-sandbox:${key}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

/** The sandbox brief — the approved demo brief, re-pointed at the sandbox practice + inbox. */
function sandboxBrief(now: Date) {
  const base = demoBrief(now);
  const contact = base.factual.contact;
  return {
    ...base,
    factual: {
      ...base.factual,
      practiceName: SANDBOX_PRACTICE_NAME,
      contact:
        contact && contact.variant === "named"
          ? { ...contact, name: SANDBOX_CONTACT_NAME, email: SANDBOX_CONTACT_EMAIL }
          : contact,
    },
  };
}

export async function seedSandboxLead(db: Database, now: Date = new Date()): Promise<string> {
  const brief = sandboxBrief(now);

  const practice = await upsertPractice(db, {
    name: SANDBOX_PRACTICE_NAME,
    geoKey: SANDBOX_GEO_KEY,
    city: brief.factual.city,
    state: brief.factual.state,
    vertical: "dermatology",
  });

  // The fired signals, so the brief renders a live buying moment (not the zero-signal
  // variant). Evidence is shared with the demo fixture (idempotent by id); the signal
  // rows are this practice's own.
  for (const s of brief.live.firedSignals) {
    await db
      .insert(evidence)
      .values({
        id: s.evidenceId,
        sourceUrl: s.sourceUrl,
        snippet: null,
        confidence: s.confidence !== null ? String(s.confidence) : null,
        detectedAt: s.detectedAt,
      })
      .onConflictDoNothing({ target: evidence.id });
    await upsertSignal(db, {
      practiceId: practice.id,
      kind: s.kind,
      evidenceId: s.evidenceId,
      confidence: s.confidence !== null ? String(s.confidence) : null,
      detectedAt: s.detectedAt,
      expiresAt: s.expiresAt,
      signalSource: s.signalSource,
    });
  }

  // The stored brief — never clobber an existing one.
  await db
    .insert(briefs)
    .values({
      practiceId: practice.id,
      factual: brief.factual,
      voice: brief.voice,
      schemaVersion: BRIEF_SCHEMA_VERSION,
      generatedAt: now,
    })
    .onConflictDoNothing({ target: briefs.practiceId });

  const [briefRow] = await db
    .select({ id: briefs.id })
    .from(briefs)
    .where(eq(briefs.practiceId, practice.id))
    .limit(1);

  // The decision-maker contact — the address the send path resolves server-side.
  const c = brief.factual.contact;
  if (c && c.variant === "named") {
    await db
      .insert(contacts)
      .values({
        id: seedId("contact"),
        practiceId: practice.id,
        name: c.name,
        role: c.role,
        email: c.email,
        emailProvider: c.emailProvider,
        linkedinUrl: c.linkedinUrl,
        bestChannel: c.bestChannel,
        personalizationSnippet: brief.voice.personalizationSnippet,
        sourceUrl: c.sourceUrl,
      })
      .onConflictDoNothing({ target: contacts.id });
  }

  // The editable 3-touch sequence, so the brief card matches the real render path.
  if (briefRow) {
    for (const touch of brief.voice.sequence.touches) {
      await db
        .insert(sequences)
        .values({
          briefId: briefRow.id,
          touchNumber: touch.touchNumber,
          channel: touch.channel,
          body: touch.body,
          cta: brief.voice.sequence.namedCta,
        })
        .onConflictDoNothing({ target: [sequences.briefId, sequences.touchNumber] });
    }
  }

  return practice.id;
}
