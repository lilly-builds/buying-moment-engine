"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { cn } from "@/design/lib/cn";
import { PageContainer } from "./layout";

/**
 * TopNav (U2 / R15) — the persistent chrome every page mounts: U8's feed,
 * U9's brief card, U12's scoreboard.
 *
 * VERIFIED-LIVE from `.new-nav-fixed`: the bar is TRANSPARENT with
 * `backdrop-filter: blur(25px)` and a 1px hairline bottom border that flips
 * `rgba(0,0,0,.05)` on light surfaces / `rgba(255,255,255,.2)` on dark ones.
 * It is not an opaque white bar, and it is not purple — the `.nav-bar` purple
 * rule in their stylesheet is a *button* modifier (`.primary-btn.nav-bar`), a
 * trap `tokens.draft.ts` correctly flagged and dodged.
 *
 * Two deliberate deviations, both because this is an app and not a landing page:
 *
 *   1. EliseAI uses `position: fixed`, which forces every page to hand-maintain a
 *      top padding equal to the nav height. This is `sticky` — same painted
 *      result, same blur, but pages can't forget the offset.
 *   2. Their nav insets 56px while their sections inset 24px, so the logo does not
 *      line up with the content beneath it. On a marketing page nobody notices; on
 *      a dashboard, a nav that doesn't align with the feed column looks broken.
 *      Ours shares `PageContainer`, so nav and content sit on the same edge.
 */

interface NavItem {
  href: string;
  label: string;
  isActive: (pathname: string) => boolean;
  /** Optional `data-tour` hook so the RevOps tour can spotlight this nav link. */
  dataTour?: string;
}

const NAV_ITEMS: readonly NavItem[] = [
  {
    href: "/",
    label: "Feed",
    // A brief card is a lead opened *from* the feed — keep Feed lit there.
    isActive: (p) => p === "/" || p.startsWith("/practice"),
  },
  {
    href: "/scoreboard",
    label: "Scoreboard",
    isActive: (p) => p.startsWith("/scoreboard"),
    dataTour: "nav-scoreboard",
  },
  {
    href: "/signals",
    label: "Signals",
    isActive: (p) => p.startsWith("/signals"),
  },
  {
    href: "/integrations",
    label: "Integrations",
    isActive: (p) => p.startsWith("/integrations"),
  },
];

export type TopNavTone = "light" | "dark";

export interface TopNavProps {
  /** `dark` for pages whose hero paints a dark or health-blue surface. */
  tone?: TopNavTone;
  /** Trailing slot — U17 hangs the HubSpot connect status here. */
  actions?: ReactNode;
  className?: string;
}

export function TopNav({ tone = "light", actions, className }: TopNavProps) {
  const pathname = usePathname();
  const dark = tone === "dark";

  return (
    <header
      className={cn(
        "sticky top-0 z-50 w-full border-b backdrop-blur-[25px]",
        dark ? "border-white/20" : "border-black/5",
        className,
      )}
    >
      <PageContainer
        as="nav"
        aria-label="Primary"
        className="flex h-[69px] items-center gap-8"
      >
        <Link
          href="/"
          className={cn(
            "flex items-center gap-2.5 rounded-control",
            dark ? "text-white" : "text-ink",
          )}
        >
          <span className="font-display text-xl font-book tracking-brand">
            EliseAI
          </span>
          <span
            className={cn(
              "rounded-pill px-2.5 py-1 font-mono text-xs font-medium uppercase leading-none",
              dark ? "bg-white/15 text-white" : "bg-surface-chip text-ink-strong",
            )}
          >
            GTM Maestro
          </span>
        </Link>

        <ul className="flex items-center gap-1">
          {NAV_ITEMS.map((item) => {
            const active = item.isActive(pathname);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  data-tour={item.dataTour}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "rounded-control px-3 py-2 font-sans text-base transition-colors",
                    active
                      ? dark
                        ? "text-white"
                        : "text-brand"
                      : dark
                        ? "text-white/70 hover:text-white"
                        : "text-ink-body hover:text-ink",
                  )}
                >
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>

        {actions ? <div className="ml-auto flex items-center gap-3">{actions}</div> : null}
      </PageContainer>
    </header>
  );
}
