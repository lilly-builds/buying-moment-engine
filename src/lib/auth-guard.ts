import { createSupabaseServerClient } from "@/src/lib/supabase/server";
import {
  isAllowlisted,
  parseAllowlist,
  requireSession,
  type RequireSessionResult,
} from "@/src/lib/auth";

/**
 * Server-side guard every mutation-capable route calls (R18). Reads the Supabase
 * session, then applies the pure `requireSession` check. Fails closed (401) if
 * Supabase is unconfigured or unreachable.
 */
export async function guardMutation(): Promise<RequireSessionResult> {
  const allowlist = parseAllowlist(process.env.ALLOWLIST_EMAILS);
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    return requireSession(
      user ? { user: { email: user.email } } : null,
      allowlist,
    );
  } catch {
    return { ok: false, status: 401, body: { error: "Not authenticated" } };
  }
}

/**
 * Read-only allowlist check for page-level guards. Mirrors `guardMutation`'s
 * session read but returns a plain boolean instead of a 401-shaped result, for
 * server components that need to belt-and-suspenders re-check the allowlist
 * before rendering real data (defense in depth against a forged
 * `active_workspace` cookie reaching a real-data page). Fails closed to `false`
 * on any error.
 */
export async function isAllowlistedRequest(): Promise<boolean> {
  const allowlist = parseAllowlist(process.env.ALLOWLIST_EMAILS);
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    return isAllowlisted(user?.email, allowlist);
  } catch {
    return false;
  }
}
