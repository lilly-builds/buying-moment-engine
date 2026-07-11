import type { Metadata } from "next";
import { getActiveWorkspace } from "@/src/workspace/active";
import { SignalsIntro } from "./signals-intro";

/**
 * /signals — the Data Sources display (page #3 of the three main screens).
 *
 * It shows where the buying-moment signals come from — three public sources feeding one
 * data store — then transitions into the prospect feed. Static shell; the choreography
 * lives in the client island. No TopNav on purpose: this is an immersive intro, not a
 * working screen, and the nav lives on the feed it hands off to.
 */

export async function generateMetadata(): Promise<Metadata> {
  const { config } = await getActiveWorkspace();
  return {
    title: `Buying Moment Signals · ${config.brand.productName}`,
    description:
      "The public data sources behind the buying-moment feed: job listings, reviews, and acquisition news.",
  };
}

export default function SignalsPage() {
  return <SignalsIntro />;
}
