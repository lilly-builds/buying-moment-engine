import type { Database } from "./types";
import { integrationRequests } from "./schema";

/**
 * Integration-requests data-layer helper (U17). Storage side of the "request an
 * integration" capture on the Connections page — one insert, returning the id so
 * the route can confirm the write actually landed (never assert success without
 * proof). Mirrors the thin-helper shape of `db/crm.ts`.
 */

export interface RecordIntegrationRequestArgs {
  tool: string;
  category?: string | null;
  note?: string | null;
  /** The allowlisted email that made the request (provenance, R17). */
  requestedBy?: string | null;
}

export async function recordIntegrationRequest(
  db: Database,
  args: RecordIntegrationRequestArgs,
): Promise<{ id: string }> {
  const [row] = await db
    .insert(integrationRequests)
    .values({
      tool: args.tool,
      category: args.category ?? null,
      note: args.note ?? null,
      requestedBy: args.requestedBy ?? null,
    })
    .returning({ id: integrationRequests.id });
  return { id: row.id };
}
