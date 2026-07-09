import { pgTable, text, uuid } from "drizzle-orm/pg-core";
import { createdAt } from "./columns";

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
