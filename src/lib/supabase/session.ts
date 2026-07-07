import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { isAllowlisted, parseAllowlist } from "@/src/lib/auth";

/**
 * Session refresh + route gate (R18), called from the root `proxy.ts`.
 * Unauthenticated or non-allowlisted users are redirected to /login. If Supabase
 * env is absent (unconfigured preview / keyless deploy) the gate passes through
 * so the app still renders.
 */

const PUBLIC_PATHS = ["/login", "/api/enrich-callback"];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

export async function updateSession(
  request: NextRequest,
): Promise<NextResponse> {
  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return response; // unconfigured -> pass through

  const supabase = createServerClient(url, anon, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const allowlist = parseAllowlist(process.env.ALLOWLIST_EMAILS);
  const authorized = isAllowlisted(user?.email, allowlist);
  const pathname = request.nextUrl.pathname;

  if (!authorized && !isPublicPath(pathname)) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/login";
    return NextResponse.redirect(redirectUrl);
  }

  return response;
}
