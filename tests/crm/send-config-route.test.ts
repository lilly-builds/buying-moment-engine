import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { createTestDb, type TestDb } from "../setup";
import { crmConnections } from "@/db/schema";
import { storeConnection } from "@/db/crm";
import { encrypt } from "@/src/crm/token-crypto";
import type { Database } from "@/db/types";
import type { RequireSessionResult } from "@/src/lib/auth";

/**
 * The per-connection send-config capture route (per-connection-send-config),
 * proven through the REAL data layer (PGlite) with the auth gate mocked — the same
 * split the other CRM route tests use. What it proves: a valid numeric sequence id
 * lands on the ACTIVE connection (portal resolved server-side, never from the body),
 * junk is refused before any write, and a missing connection fails 409.
 */

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

import { POST } from "@/app/api/hubspot/send-config/route";

const KEY = Buffer.alloc(32, 5);
const PORTAL = "portal_cfg_1";
const SIGNED_IN: RequireSessionResult = { ok: true, email: "lilly@opterraventures.com" };

function post(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/hubspot/send-config", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function seedConnection(db: Database): Promise<void> {
  await storeConnection(db, {
    provider: "hubspot",
    portalId: PORTAL,
    accessTokenEnc: encrypt("at", KEY),
    refreshTokenEnc: encrypt("rt", KEY),
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    scopes: "oauth",
    senderEmail: "rep@portal.test",
    senderUserId: "42",
  });
}

async function sequenceIdOf(db: Database): Promise<string | null> {
  const [row] = await db
    .select({ sequenceId: crmConnections.sequenceId })
    .from(crmConnections)
    .where(eq(crmConnections.portalId, PORTAL));
  return row?.sequenceId ?? null;
}

describe("POST /api/hubspot/send-config", () => {
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
    await seedConnection(t.db);
    authResult = { ok: false, status: 401, body: { error: "Not authenticated" } };
    const res = await POST(post({ sequenceId: "712515259" }));
    expect(res.status).toBe(401);
    expect(await sequenceIdOf(t.db)).toBeNull();
  });

  it("saves a numeric sequence id onto the active connection", async () => {
    await seedConnection(t.db);
    const res = await POST(post({ sequenceId: "712515259" }));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; sequenceId: string };
    expect(json).toMatchObject({ ok: true, sequenceId: "712515259" });
    expect(await sequenceIdOf(t.db)).toBe("712515259");
  });

  it("trims surrounding whitespace before saving", async () => {
    await seedConnection(t.db);
    const res = await POST(post({ sequenceId: "  712515259  " }));
    expect(res.status).toBe(200);
    expect(await sequenceIdOf(t.db)).toBe("712515259");
  });

  it("refuses a non-numeric value (e.g. a pasted full URL) with 400 and no write", async () => {
    await seedConnection(t.db);
    const res = await POST(post({ sequenceId: "/sequence/712515259/steps" }));
    expect(res.status).toBe(400);
    expect(await sequenceIdOf(t.db)).toBeNull();
  });

  it("refuses a missing sequenceId with 400", async () => {
    await seedConnection(t.db);
    const res = await POST(post({}));
    expect(res.status).toBe(400);
  });

  it("409s when no HubSpot connection is stored", async () => {
    const res = await POST(post({ sequenceId: "712515259" }));
    expect(res.status).toBe(409);
  });
});
