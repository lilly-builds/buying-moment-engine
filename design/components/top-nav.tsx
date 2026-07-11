"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentType, ReactNode, SVGProps } from "react";
import { cn } from "@/design/lib/cn";
import { PageContainer } from "./layout";
import {
  FeedIcon,
  IntegrationsIcon,
  ScoreboardIcon,
  SignalsIcon,
} from "./nav-icons";

/**
 * TopNav (U2 / R15) — the persistent chrome every page mounts: U8's feed,
 * U9's brief card, U12's scoreboard.
 *
 * VERIFIED-LIVE from `.new-nav-fixed`: the bar is TRANSPARENT with
 * `backdrop-filter: blur(25px)` and a 1px hairline bottom border that flips
 * `rgba(0,0,0,.05)` on light surfaces / `rgba(255,255,255,.2)` on dark ones.
 * It is not an opaque white bar, and it is not purple.
 *
 * RESPONSIVE MODEL — two different shapes, not one squished into the other:
 *
 *   Desktop (md:+) is the verified-live bar, byte-for-byte: transparent blur,
 *   logo left, the four text links inline beside it, `h-[69px]`.
 *
 *   Phone (< md) drops the text links out of the top bar entirely — a phone can't
 *   hold logo + four links on one 69px row without clipping the last one (the
 *   whole reason the first pass looked broken). The top bar becomes branding +
 *   context only, and navigation moves to a fixed BOTTOM TAB BAR in thumb reach
 *   (`BottomTabBar`), the pattern a phone user actually expects. Content clears it
 *   via a mobile-only `body` bottom padding in globals.css.
 *
 * Two deliberate desktop deviations, both because this is an app and not a
 * landing page: `sticky` instead of `fixed` (pages can't forget the offset), and
 * nav shares `PageContainer` so it aligns with the content column beneath it.
 */

interface NavItem {
  href: string;
  label: string;
  isActive: (pathname: string) => boolean;
  /** The bottom-tab glyph (mobile only; desktop nav is text). */
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
  /** Optional `data-tour` hook so the RevOps tour can spotlight this nav link. */
  dataTour?: string;
}

const NAV_ITEMS: readonly NavItem[] = [
  {
    href: "/",
    label: "Feed",
    // A brief card is a lead opened *from* the feed — keep Feed lit there.
    isActive: (p) => p === "/" || p.startsWith("/practice"),
    Icon: FeedIcon,
  },
  {
    href: "/scoreboard",
    label: "Scoreboard",
    isActive: (p) => p.startsWith("/scoreboard"),
    Icon: ScoreboardIcon,
    dataTour: "nav-scoreboard",
  },
  {
    href: "/signals",
    label: "Signals",
    isActive: (p) => p.startsWith("/signals"),
    Icon: SignalsIcon,
  },
  {
    href: "/integrations",
    label: "Integrations",
    isActive: (p) => p.startsWith("/integrations"),
    Icon: IntegrationsIcon,
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
    <>
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
          // Phone: a slim branding row (h-14). Desktop: the verified-live 69px bar
          // with the text links inline.
          className="flex h-14 items-center gap-x-8 md:h-[69px]"
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

          {/* Desktop links — the verified-live inline row. Hidden on phones, where
              navigation lives in the bottom tab bar. */}
          <ul className="hidden items-center gap-1 md:flex">
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

      <BottomTabBar pathname={pathname} />
    </>
  );
}

/**
 * BottomTabBar — the phone navigation (< md). Fixed to the bottom in thumb reach,
 * every destination visible at once (no scroll, no clipping), each a full tap
 * target. Opaque-white chrome with a hairline + a soft lift so it reads as a
 * distinct surface over the blue hero and stays legible whatever scrolls behind
 * it; the current tab carries the brand ink. Bottom padding clears the phone's
 * home indicator (`safe-area-inset-bottom`). Hidden at md:+ (desktop uses the top
 * bar). z-40 sits below the onboarding sheet (z-70) and the top nav (z-50).
 */
function BottomTabBar({ pathname }: { pathname: string }) {
  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-black/5 bg-surface/90 backdrop-blur-xl pb-[env(safe-area-inset-bottom)] shadow-[0_-4px_16px_-8px_rgba(24,24,25,0.18)] md:hidden"
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
                  "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand",
                  active ? "text-brand" : "text-ink-muted",
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
