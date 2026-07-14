import { describe, expect, it } from "vitest";
import nextConfig from "@/next.config";
import { SECURITY_HEADERS, securityHeadersConfig } from "@/src/lib/security-headers";

/**
 * HTTP security headers (COV-13, OWASP A02/A05). A deployed authenticated app must
 * ship clickjacking / MIME-sniff / transport hardening. This pins the policy AND that
 * next.config actually applies it to every route.
 */

function headerValue(key: string): string | undefined {
  return SECURITY_HEADERS.find((h) => h.key.toLowerCase() === key.toLowerCase())?.value;
}

describe("SECURITY_HEADERS — the hardening policy", () => {
  it("enforces HSTS with subdomains", () => {
    const hsts = headerValue("Strict-Transport-Security");
    expect(hsts).toBeDefined();
    expect(hsts).toContain("max-age=");
    expect(hsts).toContain("includeSubDomains");
  });

  it("blocks MIME sniffing and framing", () => {
    expect(headerValue("X-Content-Type-Options")).toBe("nosniff");
    expect(headerValue("X-Frame-Options")).toBe("DENY");
  });

  it("sets a Referrer-Policy and a Permissions-Policy", () => {
    expect(headerValue("Referrer-Policy")).toBeTruthy();
    expect(headerValue("Permissions-Policy")).toBeTruthy();
  });

  it("ships a CSP that stops clickjacking and base/plugin injection", () => {
    const csp = headerValue("Content-Security-Policy");
    expect(csp).toBeDefined();
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("object-src 'none'");
  });

  it("does NOT ship an unverified restrictive default-src/script-src that would break the app", () => {
    // A strict script-src/default-src needs live (Playwright) verification first — see COV-01.
    const csp = headerValue("Content-Security-Policy") ?? "";
    expect(csp).not.toContain("default-src");
    expect(csp).not.toContain("script-src");
  });
});

describe("next.config wires the headers onto every route", () => {
  it("securityHeadersConfig applies the policy to all paths", async () => {
    expect(securityHeadersConfig()).toEqual([{ source: "/(.*)", headers: SECURITY_HEADERS }]);
  });

  it("next.config.headers() returns the security policy", async () => {
    expect(typeof nextConfig.headers).toBe("function");
    const applied = await nextConfig.headers!();
    expect(applied).toEqual(securityHeadersConfig());
  });
});
