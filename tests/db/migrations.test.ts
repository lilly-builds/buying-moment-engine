import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../setup";
import {
  contacts,
  costEvents,
  evidence,
  practiceFacts,
  practices,
  signalChecks,
  signals,
} from "@/db/schema";

describe("migrations", () => {
  let t: TestDb;
  beforeEach(async () => {
    t = await createTestDb();
  });
  afterEach(async () => {
    await t.close();
  });

  it("apply cleanly to a fresh database and expose the tables", async () => {
    // If any migration failed, these selects throw.
    expect(await t.db.select().from(practices)).toEqual([]);
    expect(await t.db.select().from(signals)).toEqual([]);
    expect(await t.db.select().from(signalChecks)).toEqual([]);
    expect(await t.db.select().from(evidence)).toEqual([]);
    expect(await t.db.select().from(contacts)).toEqual([]);
    expect(await t.db.select().from(costEvents)).toEqual([]);
    // 0003 — the citation-carrying enrichment store (U5).
    expect(await t.db.select().from(practiceFacts)).toEqual([]);
  });
});
