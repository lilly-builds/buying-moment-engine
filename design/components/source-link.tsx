import type { AnchorHTMLAttributes, ReactNode } from "react";
import { cn } from "@/design/lib/cn";

/**
 * SourceLink (U2 / R15, added for U9) — text that carries a one-click citation.
 *
 * D2 is the product's trust contract: "every claim is underline-linked directly to
 * its source." The brief card renders that link dozens of times, so it is a kit
 * component, not a `text-brand underline` sprinkled through a page — a repeated
 * treatment that lives in one place cannot drift row to row, and this one encodes a
 * requirement, not a preference.
 *
 * The purple underline is EliseAI's own link treatment (see `/styleguide`, and the
 * brand-call note that links to eliseai.com/healthai). `underline-offset-4` keeps the
 * rule off the descenders.
 *
 * Always opens in a new tab: the AE is verifying a claim mid-brief, and a same-tab
 * navigation would throw away the card they are working. `rel="noreferrer"` because
 * the target is an arbitrary external page we cited, not a first-party route.
 */
export interface SourceLinkProps
  extends Omit<
    AnchorHTMLAttributes<HTMLAnchorElement>,
    "className" | "href" | "target" | "rel"
  > {
  /** The citation href — from `citationHref()`, already the deepest link the evidence supports. */
  href: string;
  className?: string;
  children: ReactNode;
}

export function SourceLink({ href, className, children, ...rest }: SourceLinkProps) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={cn(
        "font-sans text-brand underline decoration-1 underline-offset-4",
        "transition-colors duration-150 hover:text-brand-800",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand",
        className,
      )}
      {...rest}
    >
      {children}
    </a>
  );
}
