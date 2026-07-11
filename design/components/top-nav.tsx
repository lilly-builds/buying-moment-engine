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
        // Mobile: the logo + 4 links + gap-8 can't fit a phone's 69px row, so the
        // links wrap to their OWN full-width row beneath the logo (see the `<ul>`).
        // At md:+ this collapses back to the verified-live single bar, byte-for-byte
        // (`flex-nowrap` is the default, `gap-x-8` = `gap-8` on one line, `py-0` +
        // `h-[69px]` reproduce the fixed-height row).
        className="flex flex-wrap items-center gap-x-8 gap-y-3 py-3 md:h-[69px] md:flex-nowrap md:py-0"
      >
        <Link
          href="/"
          className={cn(
            "flex shrink-0 items-center gap-2.5 rounded-control",
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

        {/* `order-last` drops the links under the logo (and any actions) on a phone;
            `w-full` gives them their own row and `overflow-x-auto` lets them scroll
            if even that row is too narrow (~360px), so Scoreboard (the tour's
            `nav-scoreboard` target) stays reachable. At md:+ it's the desktop row. */}
        <ul className="order-last flex w-full items-center gap-1 overflow-x-auto md:order-none md:w-auto md:overflow-visible">
          {NAV_ITEMS.map((item) => {
            const active = item.isActive(pathname);
            return (
              // shrink-0: on the scrollable mobile row the links keep their size and
              // scroll rather than squishing; inert on the roomy desktop bar.
              <li key={item.href} className="shrink-0">
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
