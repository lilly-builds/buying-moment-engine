"use client";

import {
  createContext,
  useContext,
  type CSSProperties,
  type ReactNode,
} from "react";
import type { WorkspaceConfig } from "@/src/workspace/schema";

/**
 * design/brand-provider.tsx — the runtime theming engine's mount point (P2).
 *
 * Two jobs, both hydrated from the SERVER value so there is no flash of the wrong
 * theme:
 *   1. Paint the tenant's CSS-variable override (`design/brand.ts` `brandVars`)
 *      onto a wrapper that contains the whole app. It is a real inline `style`
 *      attribute in the server-rendered HTML, so the correct colors are present on
 *      first paint — never a useEffect that repaints after hydration.
 *   2. Expose the tenant's `productName` / `companyName` / `logoText` to client
 *      components (TopNav's wordmark, page copy) via `useBrand()`.
 *
 * The layout passes the pre-resolved `brand` and the pre-computed `vars` map
 * (`{}` for the synthetic default, so the globals.css defaults stand untouched).
 */

export interface BrandIdentity {
  productName: string;
  companyName: string;
  logoText: string;
  /**
   * True when the active workspace is the synthetic EliseAI default — i.e. no tenant
   * has been adapted. The TopNav uses it to point its logo at the marketing front
   * door (`/welcome`) in the demo/anonymous state, and at the tenant's own feed once
   * a workspace exists.
   */
  isDefault: boolean;
}

const BrandContext = createContext<BrandIdentity | null>(null);

/**
 * The active tenant's identity. Throws if no `<BrandProvider>` is above it —
 * fail loud rather than silently render a blank wordmark. The app mounts one
 * provider at the root layout, so every client component is inside it.
 */
export function useBrand(): BrandIdentity {
  const identity = useContext(BrandContext);
  if (!identity) {
    throw new Error("useBrand() must be called inside a <BrandProvider>.");
  }
  return identity;
}

export interface BrandProviderProps {
  brand: WorkspaceConfig["brand"];
  /**
   * The CSS-variable override map from `brandVars(brand)`, or `{}` for the
   * synthetic default (keep the globals.css `:root` defaults). Passed in already
   * computed so the same override the server rendered is the one the client holds.
   */
  vars: Record<string, string>;
  /** Whether the active workspace is the synthetic default (no tenant adapted yet). */
  isDefault: boolean;
  children: ReactNode;
}

export function BrandProvider({ brand, vars, isDefault, children }: BrandProviderProps) {
  const identity: BrandIdentity = {
    productName: brand.productName,
    companyName: brand.companyName,
    logoText: brand.logoText,
    isDefault,
  };

  return (
    <BrandContext.Provider value={identity}>
      {/* `display: contents` — the wrapper carries the CSS-var overrides but emits
          no box, so the body's flex layout is unchanged. CSS custom properties are
          inherited, so they still cascade to every child through it. */}
      <div className="contents" style={vars as CSSProperties}>
        {children}
      </div>
    </BrandContext.Provider>
  );
}
