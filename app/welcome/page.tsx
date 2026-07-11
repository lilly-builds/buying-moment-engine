import type { Metadata } from "next";
import { WelcomeView } from "./welcome-view";

/**
 * /welcome — the marketing front door for the SaaS shell "Moment" (Adapt-It P5).
 *
 * A pre-signup landing for an anonymous visitor: the promise, how it works, the
 * customization levers, and the one call to action (adapt it). Fixed marketing copy,
 * so the title names the shell product rather than the active workspace's wordmark.
 * No request-time data of its own — the content is static; the surrounding layout is
 * what reads the active workspace.
 */
export const metadata: Metadata = {
  title: "Moment · Reach every buyer at their buying moment",
  description:
    "Moment adapts a full buying-moment engine to any B2B business in about two minutes: your signals, your pitch, your proof, and your brand. Then it hands your team a live feed of prospects.",
};

export default function WelcomePage() {
  return <WelcomeView />;
}
