"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/design/lib/cn";
import { NAV_ITEMS } from "./top-nav";

/**
 * MobileTabBar — the phone navigation (< md).
 *
 * Mounted at the DOCUMENT ROOT (app/layout.tsx), never inside a page. That is the
 * point: `position: fixed` is only reliable when no ancestor establishes a
 * containing block, and a page's tree can grow a `transform` / `filter` /
 * `backdrop-filter` (or hit a Safari quirk) that silently turns a fixed bar into a
 * static one stuck at the document bottom. Mounting at the root removes every such
 * ancestor, so the bar always pins to the viewport.
 *
 * Chrome is the brand PURPLE (brand-800 #5627ba) — the app's action colour, not a
 * grey — translucent with a blur, the current tab crisp white against it and the
 * rest a dimmer white that reads as light-purple on the tinted bar (never grey).
 * The fill is opaque ENOUGH (92%) to stay legible even if iOS drops the
 * backdrop-filter, and the bar is promoted onto its own compositing layer
 * (`translateZ(0)`), the combination that keeps a fixed + blurred bar stable on iOS
 * Safari. Every tab is a ≥56px tap target, all four visible at once (no scroll, no
 * clipping). Bottom padding clears the home indicator. Hidden at md:+ (desktop uses
 * the top bar) and on the auth + immersive-intro screens that carry no nav.
 */

const HIDDEN_ON = ["/login", "/signals"];

export function MobileTabBar() {
  const pathname = usePathname();
  if (HIDDEN_ON.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return null;
  }

  return (
    <nav
      aria-label="Primary"
      className={cn(
        "fixed inset-x-0 bottom-0 z-40 border-t border-white/15 bg-brand-800/92 md:hidden",
        "backdrop-blur-xl [-webkit-backdrop-filter:blur(24px)] [transform:translateZ(0)]",
        "pb-[env(safe-area-inset-bottom)] shadow-[0_-8px_24px_-12px_rgba(24,11,50,0.6)]",
      )}
    >
      <ul className="mx-auto flex max-w-md items-stretch">
        {NAV_ITEMS.map((item) => {
          const active = item.isActive(pathname);
          const { Icon } = item;
          return (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                data-tour={item.dataTour}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-14 flex-col items-center justify-center gap-1 px-1 pt-2 pb-1.5 transition-colors",
                  "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-white",
                  active ? "text-white" : "text-white/60",
                )}
              >
                <Icon className="size-6 shrink-0" />
                <span
                  className={cn(
                    "font-sans text-[0.6875rem] leading-none tracking-control",
                    active ? "font-book" : "font-normal",
                  )}
                >
                  {item.label}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
