import { NextResponse, type NextRequest } from "next/server";
import { isAllowlisted, parseAllowlist } from "@/src/lib/auth";
import { createSupabaseServerClient } from "@/src/lib/supabase/server";

function safeRedirectPath(raw: string | null): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "/";
  return raw;
}

function redirectToLogin(request: NextRequest, reason: string): NextResponse {
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  url.searchParams.set("error", reason);
  return NextResponse.redirect(url);
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  if (!code) return redirectToLogin(request, "missing_code");

  let supabase;
  try {
    supabase = await createSupabaseServerClient();
  } catch {
    return redirectToLogin(request, "auth_not_configured");
  }

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return redirectToLogin(request, "invalid_link");

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!isAllowlisted(user?.email, parseAllowlist(process.env.ALLOWLIST_EMAILS))) {
    await supabase.auth.signOut();
    return redirectToLogin(request, "not_allowed");
  }

  const redirectUrl = request.nextUrl.clone();
  redirectUrl.pathname = safeRedirectPath(request.nextUrl.searchParams.get("next"));
  redirectUrl.search = "";
  return NextResponse.redirect(redirectUrl);
}
