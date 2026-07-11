import type { Metadata } from "next";
import { ChatFlow } from "./chat-flow";

export const metadata: Metadata = {
  title: "Talk your engine into shape",
  description: "Have a short conversation and watch the engine build itself around your business.",
};

/**
 * The conversational Adapt-It onboarding (a variant of `/adapt`). A pre-signup,
 * split-screen flow: the conversation on the left, the real app assembling on the
 * right. The client component owns all the state and the two Claude round-trips
 * (/api/adapt/generate, /api/adapt/finalize). It inherits the public-path auth
 * exemption because it lives under `/adapt` (see src/lib/auth.ts `publicPaths`).
 */
export default function AdaptChatPage() {
  return <ChatFlow />;
}
