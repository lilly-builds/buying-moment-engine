import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createTestDb, type TestDb } from "../setup";
import { integrationRequests } from "@/db/schema";
import type { Database } from "@/db/types";
import type { RequireSessionResult } from "@/src/lib/auth";

/**
 * The "request an integration" route (U17), proven end-to-end through the REAL
 * data layer. `getDb` is pointed at a fresh PGlite (real Postgres) and the auth
 * gate is mocked so we can walk past the 401 — exactly the split the CRM route
 * tests use. What this proves: the request actually lands in
 * `integration_requests`, stamped with the SESSION email (never the body), the
 * category is validated, and bad input is refused before any write.
 */

// Mutable holders the hoisted mocks read at CALL time (assigned in beforeEach).
let currentDb: Database | null = null;
let authResult: RequireSessionResult = {
  ok: false,
  status: 401,
  body: { error: "Not authenticated" },
};

vi.mock("@/db/client", () => ({ getDb: () => currentDb }));
vi.mock("@/src/lib/auth-guard", () => ({
  guardMutation: vi.fn(async () => authResult),
}));

import { POST } from "@/app/api/integration-requests/route";

function post(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/integration-requests", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const SIGNED_IN: RequireSessionResult = {
  ok: true,
  email: "lilly@opterraventures.com",
};

describe("POST /api/integration-requests", () => {
  let t: TestDb;
  beforeEach(async () => {
    t = await createTestDb();
    currentDb = t.db;
    authResult = SIGNED_IN;
  });
  afterEach(async () => {
    await t.close();
    currentDb = null;
  });

  it("refuses an unauthenticated request (fails closed, no write)", async () => {
    authResult = { ok: false, status: 401, body: { error: "Not authenticated" } };
    const res = await POST(post({ tool: "Salesforce", category: "crm" }));
    expect(res.status).toBe(401);

    const rows = await t.db.select().from(integrationRequests);
    expect(rows).toHaveLength(0);
  });

  it("persists a valid request stamped with the session email", async () => {
    const res = await POST(
      post({ tool: "Salesforce", category: "crm", note: "We live in it." }),
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; id: string };
    expect(json.ok).toBe(true);
    expect(json.id).toBeTruthy();

    const rows = await t.db.select().from(integrationRequests);
    expect(rows).toHaveLength(1);
    expect(rows[0].tool).toBe("Salesforce");
    expect(rows[0].category).toBe("crm");
    expect(rows[0].note).toBe("We live in it.");
    // Provenance comes from the SESSION, never the request body (R18).
    expect(rows[0].requestedBy).toBe("lilly@opterraventures.com");
  });

  it("ignores an unknown category, defaulting to 'other'", async () => {
    const res = await POST(post({ tool: "Notion", category: "wizardry" }));
    expect(res.status).toBe(200);
    const rows = await t.db.select().from(integrationRequests);
    expect(rows[0].category).toBe("other");
  });

  it("trims a blank note to null and defaults a missing category", async () => {
    const res = await POST(post({ tool: "Gong", note: "   " }));
    expect(res.status).toBe(200);
    const rows = await t.db.select().from(integrationRequests);
    expect(rows[0].note).toBeNull();
    expect(rows[0].category).toBe("other");
  });

  it("refuses an empty tool name with a 400 and writes nothing", async () => {
    const res = await POST(post({ tool: "   ", category: "sales" }));
    expect(res.status).toBe(400);
    const rows = await t.db.select().from(integrationRequests);
    expect(rows).toHaveLength(0);
  });

  it("refuses a tool name over 120 characters", async () => {
    const res = await POST(post({ tool: "x".repeat(121) }));
    expect(res.status).toBe(400);
  });
});
