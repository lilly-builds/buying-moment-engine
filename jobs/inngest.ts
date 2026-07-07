import { Inngest } from "inngest";

/**
 * Shared Inngest client. Scheduled detector runs (U3) register against this.
 * Construction is lazy — no event key needed at import time, so `next build`
 * succeeds without INNGEST_* env.
 */
export const inngest = new Inngest({ id: "buying-moment-engine" });
