import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createTestDb, type TestDb } from "../setup";
import { providerCredentials } from "@/db/schema";
import type { Database } from "@/db/types";
import type { RequireSessionResult } from "@/src/lib/auth";

/**
 * POST /api/provider-keys (U17) — proven end-to-end through the REAL data layer,
 * with the auth gate mocked (the same split the CRM + integration-request route
 * tests use). What this proves: a bad session writes nothing; a valid paste lands
 * as ENCRYPTED ciphertext (never the plaintext) and the response never echoes the
 * key; bad format / unknown provider are refused before any write; and a missing
 * encryption key fails honestly (503) instead of silently.
 */

const TEST_ENC_KEY = Buffer.alloc(32, 5).toString("base64");
const GOOD_ANTHROPIC = "sk-ant-api03-" + "a".repeat(40);

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

import { POST } from "@/app/api/provider-keys/route";

function post(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/provider-keys", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const SIGNED_IN: RequireSessionResult = { ok: true, email: "kyle@eliseai.com" };

describe("POST /api/provider-keys", () => {
  let t: TestDb;
  beforeEach(async () => {
    t = await createTestDb();
    currentDb = t.db;
    authResult = SIGNED_IN;
    process.env.TOKEN_ENCRYPTION_KEY = TEST_ENC_KEY;
  });
  afterEach(async () => {
    await t.close();
    currentDb = null;
    delete process.env.TOKEN_ENCRYPTION_KEY;
  });

  it("refuses an unauthenticated request (fails closed, no write)", async () => {
    authResult = { ok: false, status: 401, body: { error: "Not authenticated" } };
    const res = await POST(post({ provider: "anthropic", key: GOOD_ANTHROPIC }));
    expect(res.status).toBe(401);
    expect(await t.db.select().from(providerCredentials)).toHaveLength(0);
  });

  it("stores a valid key as ciphertext and never echoes the secret", async () => {
    const res = await POST(post({ provider: "anthropic", key: GOOD_ANTHROPIC }));
    expect(res.status).toBe(200);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json.ok).toBe(true);
    expect(json.provider).toBe("anthropic");
    expect(json.present).toBe(true);

    // The response must not carry the key or the ciphertext in ANY field.
    const serialized = JSON.stringify(json);
    expect(serialized).not.toContain(GOOD_ANTHROPIC);
    expect(serialized).not.toContain("sk-ant-");
    expect(json).not.toHaveProperty("key");
    expect(json).not.toHaveProperty("secretEnc");

    // At rest it is ciphertext, not the plaintext key.
    const rows = await t.db.select().from(providerCredentials);
    expect(rows).toHaveLength(1);
    expect(rows[0].provider).toBe("anthropic");
    expect(rows[0].secretEnc).not.toBe(GOOD_ANTHROPIC);
    expect(rows[0].secretEnc).not.toContain("sk-ant-");
  });

  it("re-pasting a provider's key UPDATES in place (one row)", async () => {
    await POST(post({ provider: "pdl", key: "a".repeat(40) }));
    await POST(post({ provider: "pdl", key: "b".repeat(40) }));
    const rows = await t.db.select().from(providerCredentials);
    expect(rows.filter((r) => r.provider === "pdl")).toHaveLength(1);
  });

  it("refuses a badly-formatted key with a 400 and writes nothing", async () => {
    const res = await POST(post({ provider: "anthropic", key: "not-a-real-key" }));
    expect(res.status).toBe(400);
    expect(await t.db.select().from(providerCredentials)).toHaveLength(0);
  });

  it("refuses an unknown provider with a 400", async () => {
    const res = await POST(post({ provider: "openai", key: GOOD_ANTHROPIC }));
    expect(res.status).toBe(400);
    expect(await t.db.select().from(providerCredentials)).toHaveLength(0);
  });

  it("answers 503 (not 500) when encryption isn't configured, writing nothing", async () => {
    delete process.env.TOKEN_ENCRYPTION_KEY;
    const res = await POST(post({ provider: "anthropic", key: GOOD_ANTHROPIC }));
    expect(res.status).toBe(503);
    const json = (await res.json()) as { error?: string };
    expect(json.error).toBeTruthy();
    // Nothing about the missing key value leaks into the error.
    expect(JSON.stringify(json)).not.toContain(GOOD_ANTHROPIC);
    expect(await t.db.select().from(providerCredentials)).toHaveLength(0);
  });
});
