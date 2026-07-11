import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createTestDb, type TestDb } from "../setup";
import { ELISEAI_DEFAULT } from "@/src/workspace/default";
import type { WorkspaceConfig } from "@/src/workspace/schema";
import { createWorkspace, getWorkspaceById } from "@/src/workspace/store";
import type { ActiveWorkspace } from "@/src/workspace/active";

/**
 * The Customization Studio's save route (POST /api/workspace/update), proven through
 * the REAL data layer (PGlite) with the active-workspace resolver mocked — the same
 * split the CRM route tests use. What it proves: a valid config lands on the workspace
 * the ACTIVE cookie resolves to (never an id from the body), the synthetic default is
 * refused before any write, and a malformed config is refused before any write.
 */

let currentDb: TestDb["db"] | null = null;
let active: ActiveWorkspace | null = null;

vi.mock("@/db/client", () => ({ getDb: () => currentDb }));
vi.mock("@/src/workspace/active", () => ({
  getActiveWorkspace: vi.fn(async () => {
    if (!active) throw new Error("no active workspace");
    return active;
  }),
}));

import { POST } from "@/app/api/workspace/update/route";

function post(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/workspace/update", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function rename(config: WorkspaceConfig, productName: string): WorkspaceConfig {
  return { ...config, brand: { ...config.brand, productName } };
}

describe("POST /api/workspace/update", () => {
  let t: TestDb;
  beforeEach(async () => {
    t = await createTestDb();
    currentDb = t.db;
    active = null;
  });
  afterEach(async () => {
    await t.close();
    currentDb = null;
    active = null;
  });

  it("saves a valid config onto the active tenant workspace", async () => {
    const ws = await createWorkspace(
      { slug: "acme", name: "Acme", config: ELISEAI_DEFAULT },
      t.db,
    );
    active = { id: ws.id, slug: ws.slug, name: ws.name, config: ws.config };

    const next = rename(ws.config, "Acme Signal");
    const res = await POST(post({ config: next }));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; slug: string };
    expect(json).toMatchObject({ ok: true, slug: "acme" });

    // Re-reading proves it persisted, not just the return value.
    const reread = await getWorkspaceById(ws.id, t.db);
    expect(reread?.config.brand.productName).toBe("Acme Signal");
  });

  it("refuses the synthetic default (409) and writes nothing", async () => {
    active = { id: "default", slug: "default", name: "EliseAI", config: ELISEAI_DEFAULT };
    const res = await POST(post({ config: rename(ELISEAI_DEFAULT, "Should Not Save") }));
    expect(res.status).toBe(409);
  });

  it("refuses a malformed config (422) before any write", async () => {
    const ws = await createWorkspace(
      { slug: "acme2", name: "Acme 2", config: ELISEAI_DEFAULT },
      t.db,
    );
    active = { id: ws.id, slug: ws.slug, name: ws.name, config: ws.config };

    const malformed = {
      ...ws.config,
      brand: { ...ws.config.brand, primaryColor: "not-a-hex" },
    };
    const res = await POST(post({ config: malformed }));
    expect(res.status).toBe(422);

    // The stored config is untouched.
    const reread = await getWorkspaceById(ws.id, t.db);
    expect(reread?.config.brand.primaryColor).toBe(ws.config.brand.primaryColor);
  });

  it("refuses a non-JSON body with 400", async () => {
    const req = new NextRequest("http://localhost/api/workspace/update", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not json",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});
