import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { isAllowlisted, parseAllowlist } from "@/src/lib/auth";

/**
 * Session refresh + route gate (R18), called from the root `proxy.ts`.
 * Unauthenticated or non-allowlisted users are redirected to /login.
 *
 * FAIL CLOSED: if the Supabase-Auth env is missing, non-public routes redirect to
 * /login rather than passing through — otherwise a deploy with DATABASE_URL set
 * but Supabase-Auth env absent would serve the real-contact feed with no login.
 * /login and the shared-secret callback stay reachable so it can't infinite-loop.
 */

const PUBLIC_PATHS = ["/login", "/api/enrich-callback"];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

function redirectToLogin(request: NextRequest): NextResponse {
  const redirectUrl = request.nextUrl.clone();
  redirectUrl.pathname = "/login";
  return NextResponse.redirect(redirectUrl);
}

export async function updateSession(
  request: NextRequest,
): Promise<NextResponse> {
  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    // Supabase Auth unconfigured -> deny all non-public routes (fail closed).
    return isPublicPath(request.nextUrl.pathname)
      ? response
      : redirectToLogin(request);
  }

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

  if (!authorized && !isPublicPath(request.nextUrl.pathname)) {
    return redirectToLogin(request);
  }

  return response;
}
