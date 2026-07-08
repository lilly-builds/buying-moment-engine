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
 * `/login` must always stay open or the redirect to /login would loop.
 *
 * `/api/enrich-callback` USED to be listed here. U5 deleted that route — PDL is a
 * SYNCHRONOUS request/response API (spec § Stack), so no inbound callback exists —
 * and this merge removes its auth exemption with it. An allowlist entry that names
 * a route nobody serves is dead auth surface: it survives a future re-add of the
 * path under a different owner and silently ships it unauthenticated.
 *
 * `/styleguide` is open ONLY outside production. It is U2's visual-QA surface: it
 * renders design tokens and empty component variants, and reads nothing from the
 * database — there is no lead, contact, or signal on it. Keeping it gated in
 * production preserves R18 (the deployed app never serves a page to a
 * non-allowlisted visitor); opening it in dev means brand review doesn't require
 * a Supabase round-trip. If it ever grows a real practice on it, delete this.
 */
export function publicPaths(isProduction: boolean): string[] {
  const paths = ["/login"];
  if (!isProduction) paths.push("/styleguide");
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
