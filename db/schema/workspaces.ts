import { jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { createdAt, updatedAt } from "./columns";

/**
 * Workspaces (Adapt-It P1 — plan `2026-07-11-adapt-it-saas-plan.md`) — a
 * self-contained SaaS tenant, stored as ONE row with a JSONB `config`. This is
 * the smallest correct change to add multi-tenant branding/pitch/signals/feed
 * WITHOUT migrating every entity table or adding per-table RLS tonight (that
 * is the documented production step, not this build) — see the plan's Scope
 * Boundaries.
 *
 * `config` holds the WHOLE customization surface (brand, business, signals,
 * pitch, proof, sampleFeed) validated against `WorkspaceConfigSchema`
 * (`src/workspace/schema.ts`) on every write — the DB column itself is loose
 * jsonb, same as `briefs.factual` / `briefs.voice` / `roi_events.payload`
 * elsewhere in this schema; Zod is the shape guarantee, not Postgres.
 *
 * No `vertical` / `signal_kind` pgEnum here on purpose (plan OUT-of-scope):
 * a workspace's signals are free-form JSON, decoupled from the healthcare
 * enums in `entities.ts` so an arbitrary B2B tenant is never constrained to
 * EliseAI's four verticals.
 *
 * RLS: enabled with NO policy (deny-by-default), matching every other table
 * — see the schema-barrel header in `index.ts`. All access is server-mediated
 * over DATABASE_URL via `src/workspace/store.ts`.
 */
export const workspaces = pgTable("workspaces", {
  id: uuid("id").primaryKey().defaultRandom(),
  // The active-workspace cookie + URL routing key (`src/workspace/active.ts`).
  // Unique so `getWorkspaceBySlug` is a lookup, never a scan.
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  config: jsonb("config").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}).enableRLS();
