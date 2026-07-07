import { createSupabaseServerClient } from "@/src/lib/supabase/server";
import {
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
