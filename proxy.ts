import type { NextRequest } from "next/server";
import { updateSession } from "@/src/lib/supabase/session";

// R18: refresh the Supabase session and gate app routes on every request.
// (Next.js 16 renamed Middleware -> Proxy; same functionality, `proxy.ts` root file.)
export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    // Everything except Next internals and static asset files.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
