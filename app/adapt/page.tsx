import type { Metadata } from "next";
import { AdaptFlow } from "./adapt-flow";

export const metadata: Metadata = {
  title: "Adapt this engine to your business",
  description: "Answer a few questions and watch the engine reconfigure to your business.",
};

/**
 * The Adapt-It onboarding entry (Phase 3). A pre-signup, one-thing-per-screen
 * flow: the client component owns all the state and the two Claude round-trips
 * (/api/adapt/generate, /api/adapt/finalize). No server work here beyond the
 * metadata — a brand-new business can reach `/adapt` directly.
 */
export default function AdaptPage() {
  return <AdaptFlow />;
}
