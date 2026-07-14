/**
 * Response security headers applied to every route (COV-13, OWASP A02/A05).
 *
 * These are the universally-safe hardening headers a reviewer expects on any deployed
 * authenticated app. The CSP is deliberately a *starter* policy: it stops clickjacking
 * (`frame-ancestors`), base-tag injection (`base-uri`) and plugin/object embedding
 * (`object-src`) without constraining `script-src`/`style-src` — tightening those needs
 * live (Playwright) verification that the app still renders, tracked under COV-01.
 */

export interface HttpHeader {
  key: string;
  value: string;
}

const CONTENT_SECURITY_POLICY = [
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
].join("; ");

export const SECURITY_HEADERS: HttpHeader[] = [
  // Force HTTPS for two years, including subdomains (preload-eligible).
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  // Refuse to MIME-sniff a response into an executable type.
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Legacy clickjacking defence for browsers that predate CSP frame-ancestors.
  { key: "X-Frame-Options", value: "DENY" },
  // Don't leak full URLs (which can carry tokens) to other origins.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Deny powerful features this app never uses.
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), browsing-topics=()" },
  { key: "Content-Security-Policy", value: CONTENT_SECURITY_POLICY },
];

/** The Next.js `headers()` entry that applies {@link SECURITY_HEADERS} to all routes. */
export function securityHeadersConfig(): Array<{ source: string; headers: HttpHeader[] }> {
  return [{ source: "/(.*)", headers: SECURITY_HEADERS }];
}
