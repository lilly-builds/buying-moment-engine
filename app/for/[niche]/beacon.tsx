"use client";

import { useEffect } from "react";
import type { VariantKey } from "./variants";
import { trackView } from "./analytics";

/**
 * Fires exactly one page-view beacon per mount. The server route de-duplicates
 * to one view per session per variant, so a refresh won't inflate the funnel.
 * Renders nothing.
 */
export function PageViewBeacon({ variant }: { variant: VariantKey }) {
  useEffect(() => {
    trackView(variant, `/for/${variant}`);
  }, [variant]);
  return null;
}
