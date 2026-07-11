/**
 * Pure auth helpers (R18). No I/O, no node/edge dependencies — safe to import
 * from the edge middleware AND unit-testable in isolation. The email allowlist
 * is what makes a public repo with real business-contact data safe.
 */

export function parseAllowlist(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.length > 0);
}

export function isAllowlisted(
  email: string | null | undefined,
  allowlist: string[],
): boolean {
  if (!email) return false;
  const normalized = email.trim().toLowerCase();
  if (normalized.length === 0) return false;
  return allowlist.includes(normalized);
}

/**
 * Routes reachable without a session.
 *
 * `/login` and `/auth/callback` must always stay open or the redirect to /login
 * would loop. `/auth/callback` is where Supabase lands the magic-link code — it
 * exchanges the code for a session and re-checks the allowlist before letting the
 * visitor anywhere else, so it is safe to reach without an existing session (it is
 * how you GET one).
 *
 * `/api/enrich-callback` USED to be listed here. U5 deleted that route — PDL is a
 * SYNCHRONOUS request/response API (spec § Stack), so no inbound callback exists —
 * and the main merge removed its auth exemption with it. It stays removed: an
 * allowlist entry that names a route nobody serves is dead auth surface that would
 * silently ship the path unauthenticated if it were ever re-added. (The auth
 * magic-link patch was authored before that cleanup and still listed it; we kept
 * it out on purpose.)
 *
 * `/styleguide` and `/signals` are open ONLY outside production. Both are visual
 * surfaces that read NOTHING from the database — the styleguide renders tokens and
 * empty component variants; /signals is the Data Sources intro (static source
 * labels + an animation, no lead/contact/signal on it). Keeping them gated in
 * production preserves R18 (the deployed app never serves a page to a
 * non-allowlisted visitor); opening them in dev means brand/design review doesn't
 * require a Supabase round-trip. If either ever grows a real practice on it, drop
 * it from this list.
 */
export function publicPaths(isProduction: boolean): string[] {
  const paths = ["/login", "/auth/callback", ...MARKETING_PUBLIC_PATHS];
  if (!isProduction) paths.push("/styleguide", "/signals");
  return paths;
}

/**
 * The GTM landing experiments and their capture endpoints are PUBLIC by design,
 * in production too — they are the front door of the product, meant for the whole
 * internet. This is a deliberate, contained exception to R18 (which otherwise
 * says the deployed app serves no page to a non-allowlisted visitor):
 *
 *   /for/*         the three landing pages (/for/saas | /for/outbound | /for/founders).
 *                  Static marketing copy only — they read NO lead/contact/signal
 *                  from the database. The only DB touch is the visitor's own
 *                  signup/track write below.
 *   /api/waitlist  public "get my 3 free briefs" capture. Write-only, validated,
 *                  honeypot-guarded, and it only ever writes the two RLS-locked
 *                  marketing tables (never product data).
 *   /api/track     public page-view beacon. Write-only, PII-free.
 *   /tools/*       the free lead-magnet tool (buying-moment playbook). Static +
 *                  client-only; reads NO product data. Funnels to /for/*.
 *   /moments/*     programmatic SEO pages (buying moments by industry). Static
 *                  marketing content; reads NO product data. Funnels to /for/*.
 *
 * Nothing here can read product data, so opening these does not widen R18's real
 * blast radius (the real-contact feed stays gated). If any of these ever starts
 * reading product data, drop it from this list.
 */
const MARKETING_PUBLIC_PATHS = ["/for", "/tools", "/moments", "/api/waitlist", "/api/track"];

export function isPublicPath(pathname: string, isProduction: boolean): boolean {
  return publicPaths(isProduction).some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

export interface SessionLike {
  user?: { email?: string | null } | null;
}

export type RequireSessionResult =
  | { ok: true; email: string }
  | { ok: false; status: 401; body: { error: string } };

/**
 * Server-side gate for mutation-capable routes. Returns a 401-shaped result
 * when the session is absent OR the email isn't on the allowlist. Fails closed.
 */
export function requireSession(
  session: SessionLike | null | undefined,
  allowlist: string[],
): RequireSessionResult {
  const email = session?.user?.email ?? null;
  if (!email) {
    return { ok: false, status: 401, body: { error: "Not authenticated" } };
  }
  if (!isAllowlisted(email, allowlist)) {
    return { ok: false, status: 401, body: { error: "Not authorized" } };
  }
  return { ok: true, email: email.trim().toLowerCase() };
}
