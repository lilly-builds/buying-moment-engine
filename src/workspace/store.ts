import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { workspaces } from "@/db/schema";
import type { Database } from "@/db/types";
import { WorkspaceConfigSchema, type WorkspaceConfig } from "./schema";

/**
 * Server-only DB helpers for the `workspaces` table (Adapt-It P1). Every
 * function's LAST argument is an optional `Database`, defaulting to the real
 * `getDb()` singleton (`db/client.ts`) — the same lazy-singleton every route
 * handler already uses. Tests override it with a PGlite instance
 * (`tests/setup.ts`, mirroring `db/ingest.ts`'s `upsertPractice(db, args)`
 * convention) so this module never needs its own mock.
 *
 * `config` is validated against `WorkspaceConfigSchema` on every write (R17:
 * a malformed tenant config must never ship silently, mirrors `getPack`).
 */

export interface Workspace {
  id: string;
  slug: string;
  name: string;
  config: WorkspaceConfig;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateWorkspaceInput {
  slug: string;
  name: string;
  config: WorkspaceConfig;
}

type WorkspaceRow = typeof workspaces.$inferSelect;

function toWorkspace(row: WorkspaceRow): Workspace {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    config: WorkspaceConfigSchema.parse(row.config),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** A short, URL-safe suffix for de-duping a taken slug — never a full UUID. */
function slugSuffix(): string {
  return randomBytes(3).toString("hex"); // 6 hex chars
}

/**
 * Create a workspace. Validates `config` first (fail loud on a malformed
 * config, before any write). Idempotent on slug WITHOUT throwing an
 * unhandled unique-violation: if `input.slug` is taken, a short random
 * suffix is appended and the insert is retried, so two tenants that land on
 * the same slug both get a row, distinct workspaces, never a crash and never
 * a silent overwrite of someone else's tenant.
 */
export async function createWorkspace(
  input: CreateWorkspaceInput,
  db: Database = getDb(),
): Promise<Workspace> {
  const config = WorkspaceConfigSchema.parse(input.config);

  let slug = input.slug;
  const maxAttempts = 5;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const inserted = await db
      .insert(workspaces)
      .values({ slug, name: input.name, config })
      .onConflictDoNothing({ target: workspaces.slug })
      .returning();
    if (inserted.length > 0) return toWorkspace(inserted[0]);
    slug = `${input.slug}-${slugSuffix()}`;
  }
  throw new Error(
    `createWorkspace: could not find a free slug for "${input.slug}" after ${maxAttempts} attempts`,
  );
}

export async function getWorkspaceBySlug(
  slug: string,
  db: Database = getDb(),
): Promise<Workspace | null> {
  const [row] = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.slug, slug))
    .limit(1);
  return row ? toWorkspace(row) : null;
}

export async function getWorkspaceById(
  id: string,
  db: Database = getDb(),
): Promise<Workspace | null> {
  const [row] = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.id, id))
    .limit(1);
  return row ? toWorkspace(row) : null;
}

/** Replace a workspace's config wholesale. Validates before writing (R17). */
export async function updateWorkspaceConfig(
  id: string,
  config: WorkspaceConfig,
  db: Database = getDb(),
): Promise<Workspace | null> {
  const validated = WorkspaceConfigSchema.parse(config);
  const [row] = await db
    .update(workspaces)
    .set({ config: validated })
    .where(eq(workspaces.id, id))
    .returning();
  return row ? toWorkspace(row) : null;
}

export async function listWorkspaces(
  db: Database = getDb(),
): Promise<Workspace[]> {
  const rows = await db.select().from(workspaces);
  return rows.map(toWorkspace);
}
