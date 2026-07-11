"use client";

/**
 * Client-side analytics helpers for the landing experiments. First-party and
 * PII-free: an opaque session id in localStorage (for de-duplicating views) and
 * the UTM params off the URL (for channel attribution). No third-party scripts.
 */

const SESSION_KEY = "bm_lp_session";

export function getSessionId(): string {
  if (typeof window === "undefined") return "";
  try {
    let id = window.localStorage.getItem(SESSION_KEY);
    if (!id) {
      id =
        (window.crypto?.randomUUID?.() as string | undefined) ??
        `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
      window.localStorage.setItem(SESSION_KEY, id);
    }
    return id;
  } catch {
    // Private mode / storage blocked: fall back to a per-load id.
    return `nostore-${Math.floor(Math.random() * 1e9).toString(36)}`;
  }
}

export interface Utm {
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
}

export function getUtm(): Utm {
  if (typeof window === "undefined") {
    return { utmSource: null, utmMedium: null, utmCampaign: null };
  }
  const p = new URLSearchParams(window.location.search);
  const pick = (k: string) => {
    const v = p.get(k);
    return v && v.trim().length > 0 ? v.trim().slice(0, 120) : null;
  };
  return {
    utmSource: pick("utm_source"),
    utmMedium: pick("utm_medium"),
    utmCampaign: pick("utm_campaign"),
  };
}

/** Fire-and-forget page view. Safe to call once per mount. */
export function trackView(variant: string, path: string): void {
  if (typeof window === "undefined") return;
  const body = JSON.stringify({
    variant,
    path,
    sessionId: getSessionId(),
    ...getUtm(),
  });
  try {
    // Beacon survives navigation; falls back to fetch keepalive.
    if (navigator.sendBeacon) {
      navigator.sendBeacon("/api/track", new Blob([body], { type: "application/json" }));
    } else {
      void fetch("/api/track", { method: "POST", body, headers: { "Content-Type": "application/json" }, keepalive: true });
    }
  } catch {
    // analytics must never throw into the page
  }
}
