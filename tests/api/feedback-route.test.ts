import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Route-level coverage for /api/feedback (COV-11, closing the audit's "add an API test").
 * Mocks the auth gate and the DB write so every branch is exercised hermetically.
 */

const guardMutation = vi.fn();
vi.mock("@/src/lib/auth-guard", () => ({
  guardMutation: (...args: unknown[]) => guardMutation(...args),
}));

const recordFeedback = vi.fn();
vi.mock("@/db/feedback", () => ({
  recordFeedback: (...args: unknown[]) => recordFeedback(...args),
}));

vi.mock("@/db/client", () => ({ getDb: () => ({}) }));

const { POST } = await import("@/app/api/feedback/route");

const VALID = { practiceId: "550e8400-e29b-41d4-a716-446655440000", thumb: "up" };

function req(body: unknown, opts: { raw?: boolean } = {}) {
  return new Request("http://localhost/api/feedback", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: opts.raw ? (body as string) : JSON.stringify(body),
  });
}

describe("/api/feedback POST", () => {
  beforeEach(() => {
    guardMutation.mockResolvedValue({ ok: true, email: "ae@opterra.com" });
    recordFeedback.mockResolvedValue(undefined);
  });
  afterEach(() => vi.clearAllMocks());

  it("401 when unauthenticated, and never touches the DB", async () => {
    guardMutation.mockResolvedValue({ ok: false, status: 401, body: { error: "no" } });
    const res = await POST(req(VALID));
    expect(res.status).toBe(401);
    expect(recordFeedback).not.toHaveBeenCalled();
  });

  it("400 on an invalid body (bad uuid)", async () => {
    const res = await POST(req({ practiceId: "not-a-uuid", thumb: "up" }));
    expect(res.status).toBe(400);
    expect(recordFeedback).not.toHaveBeenCalled();
  });

  it("400 on invalid JSON", async () => {
    const res = await POST(req("{not json", { raw: true }));
    expect(res.status).toBe(400);
  });

  it("uses the SESSION email, never a body-supplied one (no impersonation)", async () => {
    const res = await POST(req({ ...VALID, aeEmail: "attacker@evil.com" }));
    expect(res.status).toBe(200);
    const persisted = recordFeedback.mock.calls[0][1];
    expect(persisted.aeEmail).toBe("ae@opterra.com");
  });

  it("400 when the practice does not exist (FK violation, client error)", async () => {
    recordFeedback.mockRejectedValue(Object.assign(new Error("fk"), { code: "23503" }));
    const res = await POST(req(VALID));
    expect(res.status).toBe(400);
  });

  it("500 on an unexpected server/DB fault (so outage alerting can fire)", async () => {
    recordFeedback.mockRejectedValue(new Error("connection terminated unexpectedly"));
    const res = await POST(req(VALID));
    expect(res.status).toBe(500);
  });
});
