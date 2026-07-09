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
  const paths = ["/login", "/auth/callback"];
  if (!isProduction) paths.push("/styleguide", "/signals");
  return paths;
}

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
