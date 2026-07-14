import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../setup";
import { upsertPractice } from "@/db/ingest";
import { evidence } from "@/db/schema";

/**
 * Drizzle's PGlite driver wraps a DB error as "Failed query: …" and nests the real
 * Postgres message ("violates foreign key constraint", …) under `.cause`. Flatten the
 * whole chain so an assertion can prove the RIGHT constraint fired, not just that
 * something threw.
 */
function errorText(err: unknown): string {
  const parts: string[] = [];
  let cur: unknown = err;
  for (let depth = 0; cur && depth < 6; depth++) {
    if (cur instanceof Error) {
      parts.push(cur.message);
      cur = (cur as { cause?: unknown }).cause;
    } else {
      parts.push(typeof cur === "object" ? JSON.stringify(cur) : String(cur));
      break;
    }
  }
  return parts.join(" | ");
}

async function expectRejection(run: Promise<unknown>, pattern: RegExp): Promise<void> {
  let caught: unknown;
  try {
    await run;
  } catch (err) {
    caught = err;
  }
  expect(caught, "expected the query to be rejected by the database").toBeDefined();
  expect(errorText(caught)).toMatch(pattern);
}

/**
 * Constraint-enforcement tests (COV-09). The D13 "immaculate data-engineering"
 * guarantees live in DB constraints — provenance NOT NULL, de-dup UNIQUE, provenance
 * FKs. The idempotency suite only exercises the ON CONFLICT happy path; nothing proved
 * the constraints actually REJECT bad data. If a future migration silently drops one,
 * these turn red. Raw SQL is used deliberately so the assertion is on real Postgres
 * rejection, not Drizzle's compile-time types.
 */

describe("data-layer constraints reject bad data", () => {
  let t: TestDb;
  beforeEach(async () => {
    t = await createTestDb();
  });
  afterEach(async () => {
    await t.close();
  });

  /** A real practice + evidence so FK targets exist where a test needs a valid one. */
  async function seedRefs() {
    const practice = await upsertPractice(t.db, {
      name: "Georgia Dermatology",
      geoKey: "atlanta-ga",
      city: "Atlanta",
      state: "GA",
    });
    const [ev] = await t.db
      .insert(evidence)
      .values({
        sourceUrl: "https://boards.example.com/job/1",
        snippet: "Hiring front-desk",
        confidence: "0.8",
        detectedAt: new Date("2026-07-01T00:00:00Z"),
      })
      .returning();
    return { practiceId: practice.id, evidenceId: ev.id };
  }

  it("rejects a signal with no detected_at (provenance NOT NULL)", async () => {
    const { practiceId, evidenceId } = await seedRefs();
    await expectRejection(
      t.db.execute(sql`
        INSERT INTO signals (practice_id, kind, evidence_id)
        VALUES (${practiceId}, 'staffing_spike', ${evidenceId})
      `),
      /not-null|null value/i,
    );
  });

  it("rejects evidence with no detected_at (provenance NOT NULL)", async () => {
    await expectRejection(
      t.db.execute(sql`INSERT INTO evidence (source_url) VALUES ('https://x.example')`),
      /not-null|null value/i,
    );
  });

  it("rejects a duplicate raw_signals.dedupe_hash (idempotency UNIQUE)", async () => {
    await t.db.execute(sql`
      INSERT INTO raw_signals (dedupe_hash, detector_kind, payload)
      VALUES ('dupe-hash-1', 'adzuna', '{}'::jsonb)
    `);
    await expectRejection(
      t.db.execute(sql`
        INSERT INTO raw_signals (dedupe_hash, detector_kind, payload)
        VALUES ('dupe-hash-1', 'adzuna', '{}'::jsonb)
      `),
      /unique|duplicate key/i,
    );
  });

  it("rejects a duplicate signal on (practice, kind, evidence) (de-dup UNIQUE)", async () => {
    const { practiceId, evidenceId } = await seedRefs();
    const insertSignal = () =>
      t.db.execute(sql`
        INSERT INTO signals (practice_id, kind, evidence_id, detected_at)
        VALUES (${practiceId}, 'staffing_spike', ${evidenceId}, now())
      `);
    await insertSignal();
    await expectRejection(insertSignal(), /unique|duplicate key/i);
  });

  it("rejects a signal pointing at a non-existent practice (provenance FK)", async () => {
    const { evidenceId } = await seedRefs();
    await expectRejection(
      t.db.execute(sql`
        INSERT INTO signals (practice_id, kind, evidence_id, detected_at)
        VALUES ('00000000-0000-0000-0000-000000000000', 'staffing_spike', ${evidenceId}, now())
      `),
      /foreign key/i,
    );
  });
});

describe("information_schema pins provenance columns as NOT NULL", () => {
  let t: TestDb;
  beforeEach(async () => {
    t = await createTestDb();
  });
  afterEach(async () => {
    await t.close();
  });

  it("signals.detected_at and evidence.detected_at are NOT NULL in the live schema", async () => {
    const rows = await t.db.execute(sql`
      SELECT table_name, column_name, is_nullable
      FROM information_schema.columns
      WHERE (table_name, column_name) IN (('signals','detected_at'), ('evidence','detected_at'))
      ORDER BY table_name
    `);
    const list = (rows as unknown as { rows?: unknown[] }).rows ?? (rows as unknown as unknown[]);
    const byKey = new Map(
      (list as Array<{ table_name: string; column_name: string; is_nullable: string }>).map((r) => [
        `${r.table_name}.${r.column_name}`,
        r.is_nullable,
      ]),
    );
    expect(byKey.get("signals.detected_at")).toBe("NO");
    expect(byKey.get("evidence.detected_at")).toBe("NO");
  });
});
