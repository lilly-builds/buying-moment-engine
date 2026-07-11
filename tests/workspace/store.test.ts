import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../setup";
import { ELISEAI_DEFAULT } from "@/src/workspace/default";
import type { WorkspaceConfig } from "@/src/workspace/schema";
import {
  createWorkspace,
  getWorkspaceById,
  getWorkspaceBySlug,
  listWorkspaces,
  updateWorkspaceConfig,
} from "@/src/workspace/store";

describe("workspace store", () => {
  let t: TestDb;
  beforeEach(async () => {
    t = await createTestDb();
  });
  afterEach(async () => {
    await t.close();
  });

  it("round-trips create -> get -> update", async () => {
    const created = await createWorkspace(
      { slug: "acme-logistics", name: "Acme Logistics", config: ELISEAI_DEFAULT },
      t.db,
    );
    expect(created.slug).toBe("acme-logistics");
    expect(created.config.brand.productName).toBe(
      ELISEAI_DEFAULT.brand.productName,
    );

    const bySlug = await getWorkspaceBySlug("acme-logistics", t.db);
    expect(bySlug?.id).toBe(created.id);

    const byId = await getWorkspaceById(created.id, t.db);
    expect(byId?.slug).toBe("acme-logistics");

    const updatedConfig: WorkspaceConfig = {
      ...ELISEAI_DEFAULT,
      brand: { ...ELISEAI_DEFAULT.brand, productName: "Freight Maestro" },
    };
    const updated = await updateWorkspaceConfig(created.id, updatedConfig, t.db);
    expect(updated?.config.brand.productName).toBe("Freight Maestro");

    // The update persisted — re-reading confirms it, not just the return value.
    const reread = await getWorkspaceById(created.id, t.db);
    expect(reread?.config.brand.productName).toBe("Freight Maestro");
  });

  it("lists every created workspace", async () => {
    await createWorkspace(
      { slug: "one", name: "One", config: ELISEAI_DEFAULT },
      t.db,
    );
    await createWorkspace(
      { slug: "two", name: "Two", config: ELISEAI_DEFAULT },
      t.db,
    );
    const all = await listWorkspaces(t.db);
    expect(all.map((w) => w.slug).sort()).toEqual(["one", "two"]);
  });

  it("returns null for an unknown slug or id, never throws", async () => {
    expect(await getWorkspaceBySlug("nope", t.db)).toBeNull();
    expect(
      await getWorkspaceById("00000000-0000-0000-0000-000000000000", t.db),
    ).toBeNull();
  });

  it("is idempotent on a taken slug: it creates a distinct workspace instead of throwing", async () => {
    const first = await createWorkspace(
      { slug: "dup", name: "First", config: ELISEAI_DEFAULT },
      t.db,
    );
    const second = await createWorkspace(
      { slug: "dup", name: "Second", config: ELISEAI_DEFAULT },
      t.db,
    );

    expect(second.id).not.toBe(first.id);
    expect(second.slug).not.toBe("dup");
    expect(second.slug.startsWith("dup-")).toBe(true);

    const all = await listWorkspaces(t.db);
    expect(all).toHaveLength(2);
  });

  it("rejects a malformed config on create, before any row is written", async () => {
    const malformed = {
      ...ELISEAI_DEFAULT,
      brand: { ...ELISEAI_DEFAULT.brand, primaryColor: "not-a-hex" },
    } as unknown as WorkspaceConfig;

    await expect(
      createWorkspace({ slug: "bad", name: "Bad", config: malformed }, t.db),
    ).rejects.toThrow();

    expect(await getWorkspaceBySlug("bad", t.db)).toBeNull();
  });
});
