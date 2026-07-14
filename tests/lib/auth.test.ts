import { describe, expect, it } from "vitest";
import { isPublicPath } from "@/src/lib/auth";

describe("public auth paths", () => {
  it("lets Vercel Cron reach its secret-protected handler in production", () => {
    expect(isPublicPath("/api/cron/run-engine", true)).toBe(true);
    expect(isPublicPath("/api/cron/run-engine", false)).toBe(true);
  });

  it("does not open other API routes", () => {
    expect(isPublicPath("/api/send", true)).toBe(false);
  });

  it("lets a synthetic monitor reach /api/health unauthenticated in production", () => {
    expect(isPublicPath("/api/health", true)).toBe(true);
  });
});
