import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { updateSession } from "@/src/lib/supabase/session";
import { POST as feedbackPOST } from "@/app/api/feedback/route";
import { POST as sequencePOST } from "@/app/api/sequence/route";
import { POST as crmSyncPOST } from "@/app/api/crm-sync/route";

/**
 * Integration coverage for the auth seam (U1 DoD). Exercises the real route
 * handlers and the proxy session gate — not just the pure helpers.
 */

afterEach(() => {
  vi.unstubAllEnvs();
});

function loginPath(res: Response): string {
  return new URL(res.headers.get("location") ?? "", "http://localhost").pathname;
}

describe("mutation routes reject an unauthenticated request (guardMutation)", () => {
  it("feedback POST -> 401", async () => {
    const res = await feedbackPOST();
    expect(res.status).toBe(401);
  });
  it("sequence POST -> 401", async () => {
    const res = await sequencePOST();
    expect(res.status).toBe(401);
  });
  it("crm-sync POST -> 401", async () => {
    const res = await crmSyncPOST();
    expect(res.status).toBe(401);
  });
});

describe("updateSession route gate", () => {
  it("redirects to /login when the Supabase-Auth env is missing (fail closed)", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
    const res = await updateSession(new NextRequest("http://localhost/"));
    expect(res.status).toBe(307);
    expect(loginPath(res)).toBe("/login");
  });

  it("redirects an unauthenticated request to /login", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://dummy.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "dummy-anon-key");
    const res = await updateSession(new NextRequest("http://localhost/"));
    expect(res.status).toBe(307);
    expect(loginPath(res)).toBe("/login");
  });

  it("does not redirect /login itself (no loop) when env is missing", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
    const res = await updateSession(new NextRequest("http://localhost/login"));
    expect(res.status).toBe(200);
  });
});
