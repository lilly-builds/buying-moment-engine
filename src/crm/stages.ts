/**
 * Deal-stage → ROI milestone mapping (R12, U10). PURE — no I/O, no HubSpot client.
 *
 * Stage ids verified against a live portal's default pipeline 2026-07-08.
 *
 * WHY A MAP AND NOT "any stage change": the ROI scoreboard answers "how many
 * meetings did the tool get us?" and "are deals closing faster?". Treating every
 * stage transition as a booked meeting counts one deal four times as it walks the
 * pipeline, and treating every closed deal as a win counts losses as wins
 * (`closedlost` also reports `isClosed: true`). A stage that is neither milestone
 * logs nothing — silence beats an inflated number.
 */

export type RoiMilestone = "meeting_booked" | "deal_won";

/** HubSpot's default won-stage id. */
export const WON_STAGE_ID = "closedwon";
/** HubSpot's default lost-stage id — closed, but emphatically not a win. */
export const LOST_STAGE_ID = "closedlost";
/** HubSpot's default first stage: the AE booked the meeting. */
export const MEETING_STAGE_ID = "appointmentscheduled";

/**
 * The stage a freshly-pushed lead's deal lands in.
 *
 * Verified live 2026-07-08: a deal created with `pipeline` but no `dealstage`
 * enters NO pipeline at all — HubSpot returns `dealstage: null` AND
 * `pipeline: null`, so stage tracking and cycle time are dead on arrival.
 * Setting `dealstage` alone is sufficient (it implies the default pipeline).
 *
 * ⚠️ SEMANTIC GAP (for U12): HubSpot's default pipeline has no "lead surfaced"
 * stage — its first stage is literally "Appointment Scheduled". So a pushed lead
 * necessarily starts in the same stage that `stageMilestone` reads as a booked
 * meeting. `pushPracticeLead` therefore RECORDS this stage on the crm_link at
 * push time, so the first stage poll sees no transition and no phantom meeting is
 * ever logged. The consequence, stated honestly: with the default pipeline
 * `meeting_booked` never fires from a stage move. Giving that tile a real number
 * needs a dedicated pipeline whose first stage means "surfaced, not yet worked" —
 * a U12 decision, not something to fake here.
 */
export const INITIAL_DEAL_STAGE_ID = MEETING_STAGE_ID;

/**
 * Null-prototype on purpose: HubSpot stage ids are portal-controlled strings, so
 * a plain object literal would resolve `"constructor"` or `"toString"` off
 * Object.prototype and hand back a truthy non-milestone.
 */
const STAGE_MILESTONES: Readonly<Record<string, RoiMilestone>> =
  Object.assign(Object.create(null) as Record<string, RoiMilestone>, {
    [MEETING_STAGE_ID]: "meeting_booked",
    [WON_STAGE_ID]: "deal_won",
  });

/**
 * The ROI milestone a deal reaching `stage` represents, or null when the stage
 * is a mid-pipeline step (or a loss) that no tile should count.
 */
export function stageMilestone(
  stage: string | null | undefined,
): RoiMilestone | null {
  if (!stage) return null;
  return STAGE_MILESTONES[stage] ?? null;
}
