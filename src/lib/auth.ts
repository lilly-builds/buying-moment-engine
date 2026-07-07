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
