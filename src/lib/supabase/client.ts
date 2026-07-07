import { createBrowserClient } from "@supabase/ssr";

/**
 * Supabase browser client (@supabase/ssr) for client components (e.g. /login).
 */
export function createSupabaseBrowserClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) throw new Error("Supabase env not configured");
  return createBrowserClient(url, anon);
}
