import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("production cron schedule", () => {
  it("separates source collection from later downstream drains and mounts every route", () => {
    const config = JSON.parse(
      readFileSync(resolve(process.cwd(), "vercel.json"), "utf8"),
    ) as {
      crons: Array<{ path: string; schedule: string }>;
    };

    expect(config.crons.some((cron) => cron.path === "/api/cron/run-engine")).toBe(
      false,
    );
    const sources = config.crons.filter((cron) => cron.path.endsWith("/sources"));
    const downstream = config.crons.filter((cron) =>
      cron.path.endsWith("/downstream"),
    );
    expect(sources).toHaveLength(1);
    expect(downstream.length).toBeGreaterThanOrEqual(1);
    const sourceHour = Number(sources[0].schedule.split(/\s+/)[1]);
    for (const cron of downstream) {
      expect(Number(cron.schedule.split(/\s+/)[1])).toBeGreaterThan(sourceHour);
    }
    expect(
      new Set(config.crons.map((cron) => `${cron.path} ${cron.schedule}`)).size,
    ).toBe(config.crons.length);
    for (const cron of config.crons) {
      expect(
        existsSync(
          resolve(
            process.cwd(),
            "app",
            cron.path.replace(/^\//, ""),
            "route.ts",
          ),
        ),
      ).toBe(true);
    }
  });

  it("keeps every Hobby-plan cron expression to at most one invocation per day", () => {
    const config = JSON.parse(
      readFileSync(resolve(process.cwd(), "vercel.json"), "utf8"),
    ) as {
      crons: Array<{ schedule: string }>;
    };

    for (const cron of config.crons) {
      const [minute, hour] = cron.schedule.trim().split(/\s+/);
      expect(minute).toMatch(/^\d+$/);
      expect(hour).toMatch(/^\d+$/);
    }
  });
});
