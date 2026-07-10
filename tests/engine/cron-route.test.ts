import { afterEach, describe, expect, it } from "vitest";
import { GET, resolveBriefLimit } from "@/app/api/cron/run-engine/route";
import { DEFAULT_ENGINE_BRIEF_LIMIT, MAX_ENGINE_BRIEF_LIMIT } from "@/jobs/run-engine";

/**
 * The scheduled engine trigger is fail-closed (Thread 06): only Vercel Cron, carrying the
 * `Authorization: Bearer $CRON_SECRET` header, may fire it. A public engine run would burn paid
 * API budget, so anything else is rejected BEFORE the handler touches the DB or any provider.
 */
describe("cron route auth (fail-closed)", () => {
  const original = process.env.CRON_SECRET;
  afterEach(() => {
    if (original === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = original;
  });

  it("401s when no CRON_SECRET is configured — no secret means nobody may trigger", async () => {
    delete process.env.CRON_SECRET;
    const res = await GET(new Request("https://app/api/cron/run-engine"));
    expect(res.status).toBe(401);
  });

  it("401s on a wrong bearer token", async () => {
    process.env.CRON_SECRET = "s3cret";
    const res = await GET(
      new Request("https://app/api/cron/run-engine", {
        headers: { authorization: "Bearer not-the-secret" },
      }),
    );
    expect(res.status).toBe(401);
  });

  it("401s when the Authorization header is missing entirely", async () => {
    process.env.CRON_SECRET = "s3cret";
    const res = await GET(new Request("https://app/api/cron/run-engine"));
    expect(res.status).toBe(401);
  });
});

/**
 * Regression guard: a BLANK ENGINE_BRIEF_LIMIT (what .env.example ships) must NOT coerce to 0 and
 * silently disable the brief cascade — it must fall back to the default. A deliberate "0" is still
 * honored; garbage/negative fall back too.
 */
describe("resolveBriefLimit", () => {
  const original = process.env.ENGINE_BRIEF_LIMIT;
  afterEach(() => {
    if (original === undefined) delete process.env.ENGINE_BRIEF_LIMIT;
    else process.env.ENGINE_BRIEF_LIMIT = original;
  });

  it("blank → default (the .env.example footgun)", () => {
    process.env.ENGINE_BRIEF_LIMIT = "";
    expect(resolveBriefLimit()).toBe(DEFAULT_ENGINE_BRIEF_LIMIT);
  });

  it("unset → default", () => {
    delete process.env.ENGINE_BRIEF_LIMIT;
    expect(resolveBriefLimit()).toBe(DEFAULT_ENGINE_BRIEF_LIMIT);
  });

  it("a valid number is honored", () => {
    process.env.ENGINE_BRIEF_LIMIT = "3";
    expect(resolveBriefLimit()).toBe(3);
  });

  it("a deliberate 0 is honored (sources-only by choice)", () => {
    process.env.ENGINE_BRIEF_LIMIT = "0";
    expect(resolveBriefLimit()).toBe(0);
  });

  it("garbage / negative → default (never NaN into the query)", () => {
    process.env.ENGINE_BRIEF_LIMIT = "abc";
    expect(resolveBriefLimit()).toBe(DEFAULT_ENGINE_BRIEF_LIMIT);
    process.env.ENGINE_BRIEF_LIMIT = "-5";
    expect(resolveBriefLimit()).toBe(DEFAULT_ENGINE_BRIEF_LIMIT);
  });

  it("a huge value is clamped to the ceiling (can't defeat the 300s bound)", () => {
    process.env.ENGINE_BRIEF_LIMIT = "100000";
    expect(resolveBriefLimit()).toBe(MAX_ENGINE_BRIEF_LIMIT);
  });
});
