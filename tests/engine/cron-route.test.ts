import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_DISCOVERY_METRO_LIMIT,
  DEFAULT_DISCOVERY_PER_CATEGORY_LIMIT,
  DEFAULT_DISCOVERY_REVIEW_LIMIT,
  MAX_DISCOVERY_METRO_LIMIT,
  MAX_DISCOVERY_PER_CATEGORY_LIMIT,
  MAX_DISCOVERY_REVIEW_LIMIT,
  SCHEDULED_DOWNSTREAM_LIMIT,
  createInvocationBudget,
  resolveBriefLimit,
  resolveDiscoveryMetroLimit,
  resolveDiscoveryPerCategoryLimit,
  resolveDiscoveryReviewLimit,
  resolveScheduledBriefLimit,
} from "@/app/api/cron/run-engine/config";
import { GET } from "@/app/api/cron/run-engine/route";
import { DEFAULT_ENGINE_BRIEF_LIMIT, MAX_ENGINE_BRIEF_LIMIT } from "@/jobs/run-engine";
import {
  GET as GET_SOURCES,
  maxDuration as sourceMaxDuration,
} from "@/app/api/cron/run-engine/sources/route";
import {
  GET as GET_DOWNSTREAM,
  maxDuration as downstreamMaxDuration,
} from "@/app/api/cron/run-engine/downstream/route";
import { ENGINE_RUN_STALE_AFTER_MS } from "@/db/engine-runs";

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

  it("keeps both scheduled phase routes behind the same fail-closed auth gate", async () => {
    delete process.env.CRON_SECRET;
    expect(
      (await GET_SOURCES(new Request("https://app/api/cron/run-engine/sources")))
        .status,
    ).toBe(401);
    expect(
      (
        await GET_DOWNSTREAM(
          new Request("https://app/api/cron/run-engine/downstream"),
        )
      ).status,
    ).toBe(401);
  });

  it("rejects the unsafe combined route and points operators to split phases", async () => {
    process.env.CRON_SECRET = "s3cret";
    const res = await GET(
      new Request("https://app/api/cron/run-engine", {
        headers: { authorization: "Bearer s3cret" },
      }),
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ ran: false });
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


describe("manual cron canary controls", () => {
  it("query limit overrides the env limit for one authorized manual trigger", () => {
    process.env.ENGINE_BRIEF_LIMIT = "10";
    expect(resolveBriefLimit(new Request("https://app/api/cron/run-engine?limit=1"))).toBe(1);
  });

  it("query limit is still clamped", () => {
    expect(resolveBriefLimit(new Request("https://app/api/cron/run-engine?limit=999"))).toBe(MAX_ENGINE_BRIEF_LIMIT);
  });
});

describe("scheduled downstream safety", () => {
  const original = process.env.ENGINE_BRIEF_LIMIT;
  afterEach(() => {
    if (original === undefined) delete process.env.ENGINE_BRIEF_LIMIT;
    else process.env.ENGINE_BRIEF_LIMIT = original;
  });

  it("defaults scheduled downstream runs to one lead while preserving manual overrides", () => {
    delete process.env.ENGINE_BRIEF_LIMIT;
    const request = new Request("https://app/api/cron/run-engine/downstream");
    expect(resolveScheduledBriefLimit(request, "downstream", true)).toBe(
      SCHEDULED_DOWNSTREAM_LIMIT,
    );
    expect(
      resolveScheduledBriefLimit(
        new Request("https://app/api/cron/run-engine/downstream?limit=3"),
        "downstream",
        true,
      ),
    ).toBe(3);
    expect(resolveScheduledBriefLimit(request, "downstream", false)).toBe(0);
  });

  it("does not let a legacy env value or blank query raise the scheduled cap", () => {
    process.env.ENGINE_BRIEF_LIMIT = "50";
    expect(
      resolveScheduledBriefLimit(
        new Request("https://app/api/cron/run-engine/downstream"),
        "downstream",
        true,
      ),
    ).toBe(SCHEDULED_DOWNSTREAM_LIMIT);
    expect(
      resolveScheduledBriefLimit(
        new Request("https://app/api/cron/run-engine/downstream?limit="),
        "downstream",
        true,
      ),
    ).toBe(SCHEDULED_DOWNSTREAM_LIMIT);
  });

  it("stops starting leads and retries before the hard function ceiling", () => {
    let now = 1_000;
    const budget = createInvocationBudget(() => now);
    expect(budget.canStartLead()).toBe(true);
    expect(budget.canStartVoiceAttempt()).toBe(true);

    now += 60_001;
    expect(budget.canStartLead()).toBe(false);
    expect(budget.canStartVoiceAttempt()).toBe(true);

    now += 80_000;
    expect(budget.canStartVoiceAttempt()).toBe(false);
  });

  it("only calls a running receipt stale after max duration plus a one-minute margin", () => {
    expect(sourceMaxDuration).toBe(300);
    expect(downstreamMaxDuration).toBe(300);
    expect(ENGINE_RUN_STALE_AFTER_MS).toBe(
      downstreamMaxDuration * 1_000 + 60_000,
    );
  });
});


describe("resolveDiscoveryMetroLimit", () => {
  const original = process.env.DISCOVERY_METRO_LIMIT;
  afterEach(() => {
    if (original === undefined) delete process.env.DISCOVERY_METRO_LIMIT;
    else process.env.DISCOVERY_METRO_LIMIT = original;
  });

  it("defaults to the production metro batch size", () => {
    delete process.env.DISCOVERY_METRO_LIMIT;
    expect(resolveDiscoveryMetroLimit()).toBe(DEFAULT_DISCOVERY_METRO_LIMIT);
  });

  it("honors env and one-off query overrides with a ceiling", () => {
    process.env.DISCOVERY_METRO_LIMIT = "7";
    expect(resolveDiscoveryMetroLimit()).toBe(7);
    expect(
      resolveDiscoveryMetroLimit(
        new Request("https://app/api/cron/run-engine?metroLimit=3"),
      ),
    ).toBe(3);
    expect(
      resolveDiscoveryMetroLimit(
        new Request("https://app/api/cron/run-engine?metroLimit=999"),
      ),
    ).toBe(MAX_DISCOVERY_METRO_LIMIT);
  });
});


describe("resolveDiscovery work limits", () => {
  it("defaults and clamps candidate/review work caps", () => {
    expect(resolveDiscoveryPerCategoryLimit()).toBe(DEFAULT_DISCOVERY_PER_CATEGORY_LIMIT);
    expect(resolveDiscoveryReviewLimit()).toBe(DEFAULT_DISCOVERY_REVIEW_LIMIT);
    expect(
      resolveDiscoveryPerCategoryLimit(
        new Request("https://app/api/cron/run-engine?discoveryLimit=999"),
      ),
    ).toBe(MAX_DISCOVERY_PER_CATEGORY_LIMIT);
    expect(
      resolveDiscoveryReviewLimit(
        new Request("https://app/api/cron/run-engine?reviewLimit=999"),
      ),
    ).toBe(MAX_DISCOVERY_REVIEW_LIMIT);
  });
});
