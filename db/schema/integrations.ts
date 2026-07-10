import { pgTable, text, unique, uuid } from "drizzle-orm/pg-core";
import { createdAt, updatedAt } from "./columns";

/**
 * integration_requests (U17) — the "request an integration" capture on the
 * Connections page. When an admin/AE wants a CRM, marketing, or sales tool the
 * engine doesn't yet connect, this row turns that ask into a tracked demand
 * signal (D14: demand-driven rollout — "each rep's tap aggregates into visible
 * demand") instead of a mailto that evaporates. It is the system-of-record proof
 * that the request field is wired end-to-end, not a decorative input.
 *
 * Business data only (D9). The only person-shaped field is `requested_by` — the
 * allowlisted WORK email that already gates every mutation (R18); no PII/PHI.
 */
export const integrationRequests = pgTable("integration_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  // The tool the requester wants connected — free text (e.g. "Salesforce").
  tool: text("tool").notNull(),
  // crm | marketing | sales | other. Free text so a new category never needs a
  // migration; the route validates the value against the known set.
  category: text("category"),
  // Optional context the requester typed.
  note: text("note"),
  // Provenance (R17): the allowlisted email that made the request.
  requestedBy: text("requested_by"),
  createdAt: createdAt(),
}).enableRLS();

/**
 * provider_credentials (U17 · spec § Stack) — the two BYOK engine keys the tool
 * runs on: Anthropic (research + brief voice) and PDL (contact enrichment). The
 * Admin/RevOps archetype pastes each key ONCE on the Connections surface; it is
 * encrypted at rest here and read back only server-side to make the paid calls.
 *
 * Encryption is the SAME pattern as `crm_connections` (AES-256-GCM via
 * `src/crm/token-crypto.ts`, keyed by `TOKEN_ENCRYPTION_KEY`): only the
 * ciphertext (`secret_enc`) ever touches a column — the plaintext key is never
 * stored, never logged, and never returned to the client (D9). The table is
 * RLS-locked with no public policy, so the key is reachable only through the
 * server's owner connection, never the browser/anon client.
 *
 * Single row per `provider` — re-pasting a key UPDATES in place (idempotent),
 * never duplicates. No tenant column: this is EliseAI's own single-instance
 * internal tool, and RLS (not a tenant id) is the isolation boundary.
 */
export const providerCredentials = pgTable(
  "provider_credentials",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Which engine credential: "anthropic" | "pdl". The route validates the value
    // against the known set before a row is ever written.
    provider: text("provider").notNull(),
    // AES-256-GCM ciphertext of the BYOK API key — NEVER plaintext, NEVER logged (D9).
    secretEnc: text("secret_enc").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  // One connection per provider — re-pasting UPDATES, never dupes.
  (t) => [unique("provider_credentials_provider_uq").on(t.provider)],
).enableRLS();
