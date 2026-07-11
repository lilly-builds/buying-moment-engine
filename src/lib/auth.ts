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
 * `/welcome` is the marketing front door (Adapt-It P5) — the SaaS shell's public
 * landing for an anonymous visitor. It is open in EVERY environment, including
 * production, because a front door that a login wall hides is not a front door. It
 * is safe to expose: it reads NOTHING from the database — only fixed marketing copy
 * and the design system — so it carries the same zero-data profile as /styleguide,
 * without the dev-only restriction those pages keep. Its calls to action still route
 * through the gate (a non-allowlisted visitor who taps "Adapt it" lands on /login
 * first), so opening the door leaks no data and gates no policy.
 *
 * `/styleguide` and `/signals` are open ONLY outside production. Both are visual
 * surfaces that read NOTHING from the database — the styleguide renders tokens and
 * empty component variants; /signals is the Data Sources intro (static source
 * labels + an animation, no lead/contact/signal on it). Keeping them gated in
 * production preserves R18 (the deployed app never serves a page to a
 * non-allowlisted visitor); opening them in dev means brand/design review doesn't
 * require a Supabase round-trip. If either ever grows a real practice on it, drop
 * it from this list.
 *
 * `/adapt` and `/api/adapt` are the self-serve onboarding flow and its
 * generate/finalize routes (Adapt-It). They are open in EVERY environment,
 * including production, because onboarding necessarily precedes any session — a
 * business signing up has no allowlisted account yet, and the `active_workspace`
 * cookie it earns at the end of the flow is the FIRST credential it gets. These
 * routes DO spend Claude (LLM generation) pre-auth; there is no session to gate
 * the spend on yet. Abuse rate-limiting is documented roadmap, not implemented
 * here.
 */
export function publicPaths(isProduction: boolean): string[] {
  const paths = [
    "/login",
    "/auth/callback",
    "/welcome",
    "/adapt",
    "/api/adapt",
  ];
  if (!isProduction) paths.push("/styleguide", "/signals");
  return paths;
}

export function isPublicPath(pathname: string, isProduction: boolean): boolean {
  return publicPaths(isProduction).some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

/**
 * The tenant-app route trees (Adapt-It self-serve layer): exactly the surfaces
 * that a tenant's own `active_workspace` cookie is allowed to unlock without an
 * allowlisted session. Every route in this set renders only that tenant's own
 * AI-generated SAMPLE data — never real business-contact data — so a forged
 * cookie can, at worst, expose synthetic rows. `/practice` is deliberately NOT
 * included: it renders real data and must stay allowlist-only.
 */
export function isTenantAppPath(pathname: string): boolean {
  if (pathname === "/") return true;
  const roots = ["/prospect", "/customize", "/scoreboard", "/api/workspace"];
  return roots.some((root) => pathname === root || pathname.startsWith(`${root}/`));
}

/**
 * True only for a genuine tenant slug: non-empty, and not one of the two values
 * that map to the real-data EliseAI default workspace — "default" (the synthetic
 * fallback `getActiveWorkspace` returns when no cookie/workspace resolves) and
 * "eliseai" (the reserved slug for a DB-seeded EliseAI workspace, if one is ever
 * created). Neither may grant tenant-app access via cookie: that would let a
 * forged cookie unlock the default workspace's real-data path.
 */
export function isTenantWorkspaceCookieValue(
  value: string | null | undefined,
): boolean {
  if (!value) return false;
  return value !== "default" && value !== "eliseai";
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
