import { inngest } from "./inngest";

/**
 * Placeholder scheduled detector run. U3 builds the detector framework and fills
 * the body (fetch -> normalize -> emit -> persist with dedupe + freshness). Kept
 * minimal here so the deploy rail and Inngest registration exist from U1.
 */
export const runDetectors = inngest.createFunction(
  { id: "run-detectors", triggers: [{ cron: "0 */6 * * *" }] },
  async () => {
    return {
      ran: false,
      note: "placeholder — detector framework lands in U3",
    };
  },
);
