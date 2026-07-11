import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Landing } from "./landing";
import { VARIANTS, VARIANT_KEYS, isVariantKey } from "./variants";

/**
 * The three landing experiments live at /for/saas, /for/outbound, /for/founders.
 * One template, config-driven. Unknown slugs 404. Statically generated at build
 * (the three known slugs), so the pages are fast and cacheable; the only dynamic
 * calls are the client-side capture/track beacons.
 */

export function generateStaticParams() {
  return VARIANT_KEYS.map((niche) => ({ niche }));
}

// Unknown slugs are not valid pages.
export const dynamicParams = false;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ niche: string }>;
}): Promise<Metadata> {
  const { niche } = await params;
  if (!isVariantKey(niche)) return {};
  const config = VARIANTS[niche];
  return {
    title: config.metaTitle,
    description: config.metaDescription,
    openGraph: {
      title: config.metaTitle,
      description: config.metaDescription,
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title: config.metaTitle,
      description: config.metaDescription,
    },
  };
}

export default async function LandingRoute({
  params,
}: {
  params: Promise<{ niche: string }>;
}) {
  const { niche } = await params;
  if (!isVariantKey(niche)) notFound();
  return <Landing config={VARIANTS[niche]} />;
}
