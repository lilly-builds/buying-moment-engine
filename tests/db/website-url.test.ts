import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, type TestDb } from "../setup";
import { setPracticeWebsite, upsertPractice } from "@/db/ingest";
import { practices } from "@/db/schema";

/**
 * U1 — `practices.website_url` (the scrape seed) is written NON-destructively.
 * Two writers touch it: `upsertPractice` on create (Plan A capture-at-source) and
 * `setPracticeWebsite` fill-if-null (Plan B deliberate search). Neither may clobber
 * a website already on file — the D13/R17 "never blindly overwrite a real value" line.
 */
describe("practices.website_url", () => {
  let t: TestDb;
  beforeEach(async () => {
    t = await createTestDb();
  });
  afterEach(async () => {
    await t.close();
  });

  const websiteOf = async (id: string): Promise<string | null> => {
    const [row] = await t.db
      .select({ websiteUrl: practices.websiteUrl })
      .from(practices)
      .where(eq(practices.id, id))
      .limit(1);
    return row?.websiteUrl ?? null;
  };

  it("defaults website_url to null when unset", async () => {
    const p = await upsertPractice(t.db, { name: "Metro Derm", geoKey: "austin-tx" });
    expect(await websiteOf(p.id)).toBeNull();
  });

  it("persists websiteUrl when creating a new practice", async () => {
    const p = await upsertPractice(t.db, {
      name: "Sunrise Dermatology",
      geoKey: "austin-tx",
      websiteUrl: "https://sunrisederm.com",
    });
    expect(await websiteOf(p.id)).toBe("https://sunrisederm.com");
  });

  it("does NOT overwrite an existing website_url on re-upsert (never clobber)", async () => {
    const first = await upsertPractice(t.db, {
      name: "Sunrise Dermatology",
      geoKey: "austin-tx",
      websiteUrl: "https://sunrisederm.com",
    });
    // Same practice re-seen with a different (worse) url — ON CONFLICT DO NOTHING.
    const second = await upsertPractice(t.db, {
      name: "Sunrise Dermatology",
      geoKey: "austin-tx",
      websiteUrl: "https://wrong.example.com",
    });
    expect(second.id).toBe(first.id);
    expect(await websiteOf(first.id)).toBe("https://sunrisederm.com");
  });

  it("setPracticeWebsite fills a null website_url and returns it", async () => {
    const p = await upsertPractice(t.db, { name: "Metro Derm", geoKey: "austin-tx" });
    const stored = await setPracticeWebsite(t.db, p.id, "https://metroderm.com");
    expect(stored).toBe("https://metroderm.com");
    expect(await websiteOf(p.id)).toBe("https://metroderm.com");
  });

  it("setPracticeWebsite leaves a non-null website_url unchanged and returns the existing one", async () => {
    const p = await upsertPractice(t.db, {
      name: "Sunrise Dermatology",
      geoKey: "austin-tx",
      websiteUrl: "https://sunrisederm.com",
    });
    const stored = await setPracticeWebsite(t.db, p.id, "https://override.example.com");
    expect(stored).toBe("https://sunrisederm.com");
    expect(await websiteOf(p.id)).toBe("https://sunrisederm.com");
  });
});
