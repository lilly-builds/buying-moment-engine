import type { NextRequest } from "next/server";
import { updateSession } from "@/src/lib/supabase/session";

// R18: refresh the Supabase session and gate app routes on every request.
// (Next.js 16 renamed Middleware -> Proxy; same functionality, `proxy.ts` root file.)
export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    // Everything except Next internals and static asset files. Video/audio
    // extensions belong here for the same reason the image ones do: a static
    // file in /public is not an app route, and running a <video>'s Range
    // requests through the Supabase session refresh is pure waste. (The intro
    // on /signals streams `/media/*.mp4`.)
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|mp4|webm|mov|m4v|mp3|wav)$).*)",
  ],
};
