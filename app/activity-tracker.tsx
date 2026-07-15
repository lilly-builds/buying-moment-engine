"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

/**
 * Fires a first-party page-view beacon to `/api/track` on every route change,
 * including App Router soft navigations. Renders nothing.
 *
 * Why a beacon and not a third-party snippet: the visitors we care about most are
 * enterprise orgs whose browsers/networks routinely block third-party analytics.
 * A same-origin POST to our own API is not blocked, and the session cookie rides
 * along so the server can attribute the view to the real signed-in user.
 *
 * `navigator.sendBeacon` is used first because it survives the very navigation
 * that triggers it; `fetch(..., { keepalive: true })` is the fallback. Any failure
 * is swallowed — analytics must never break the page.
 */

// No session exists on these, so a beacon would only 302 to /login. Skip them.
const SKIP_PREFIXES = ["/login", "/auth"];

function shouldSkip(pathname: string): boolean {
  return SKIP_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

export function ActivityTracker() {
  const pathname = usePathname();
  const lastSent = useRef<string | null>(null);

  useEffect(() => {
    if (!pathname || shouldSkip(pathname)) return;
    // De-dupe: React can re-run this effect for the same path (e.g. Strict Mode
    // double-invoke in dev); one view per distinct path transition is enough.
    if (lastSent.current === pathname) return;
    lastSent.current = pathname;

    const body = JSON.stringify({ path: pathname });
    try {
      if (typeof navigator !== "undefined" && navigator.sendBeacon) {
        navigator.sendBeacon(
          "/api/track",
          new Blob([body], { type: "application/json" }),
        );
      } else {
        void fetch("/api/track", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
          keepalive: true,
        });
      }
    } catch {
      // Swallow — a failed view log is never worth interrupting the visitor.
    }
  }, [pathname]);

  return null;
}
