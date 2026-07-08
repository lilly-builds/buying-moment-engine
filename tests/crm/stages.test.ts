import { describe, expect, it } from "vitest";
import {
  INITIAL_DEAL_STAGE_ID,
  LOST_STAGE_ID,
  MEETING_STAGE_ID,
  stageMilestone,
  WON_STAGE_ID,
} from "@/src/crm/stages";
import { dealCreateProperties, dealUpdateProperties } from "@/src/crm/tags";
import type { LeadInput } from "@/src/crm/adapter";

const LEAD: LeadInput = {
  companyName: "Georgia Dermatology",
  tags: { vertical: "dermatology", signalSource: "staffing-spike", signalCount: 2 },
};

describe("deal properties: create places it in a pipeline, update never moves it", () => {
  it("CREATE sets dealstage — a deal with only `pipeline` enters NO pipeline at all", () => {
    // Verified live 2026-07-08: {pipeline:"default"} alone -> dealstage:null AND
    // pipeline:null. Setting dealstage alone implies the default pipeline.
    const props = dealCreateProperties(LEAD, "custom");
    expect(props.dealstage).toBe(INITIAL_DEAL_STAGE_ID);
    expect(props.dealname).toBeDefined();
  });

  it("CREATE carries the tags so pipeline reports slice by them", () => {
    const props = dealCreateProperties(LEAD, "custom");
    expect(props.vertical).toBe("dermatology");
    expect(props.signal_source).toBe("staffing-spike");
  });

  it("UPDATE never sends dealstage — a re-push must not drag a won deal backwards", () => {
    // R17, never blindly overwrite a real record. dealstage + dealname belong to
    // the AE once the deal exists; only the tags are ours to refresh.
    const props = dealUpdateProperties(LEAD, "custom");
    expect(props.dealstage).toBeUndefined();
    expect(props.dealname).toBeUndefined();
  });

  it("UPDATE still refreshes the tags (a second signal fired)", () => {
    const props = dealUpdateProperties(
      { ...LEAD, tags: { ...LEAD.tags, signalCount: 3 } },
      "custom",
    );
    expect(props.signal_count).toBe("3");
    expect(props.vertical).toBe("dermatology");
  });
});

/**
 * Stage ids verified against a live portal's default pipeline 2026-07-08:
 * appointmentscheduled · qualifiedtobuy · presentationscheduled ·
 * decisionmakerboughtin · contractsent · closedwon · closedlost.
 */
describe("stageMilestone (which stage changes the ROI scoreboard counts)", () => {
  it("the appointment stage is a booked meeting", () => {
    expect(stageMilestone(MEETING_STAGE_ID)).toBe("meeting_booked");
  });

  it("the won stage is a won deal", () => {
    expect(stageMilestone(WON_STAGE_ID)).toBe("deal_won");
  });

  it("a LOST deal is no milestone — closedlost also reports isClosed:true", () => {
    expect(stageMilestone(LOST_STAGE_ID)).toBeNull();
  });

  it.each([
    "qualifiedtobuy",
    "presentationscheduled",
    "decisionmakerboughtin",
    "contractsent",
  ])("mid-pipeline stage %s is no milestone", (stage) => {
    // Otherwise one deal walking the pipeline books four "meetings" (R12).
    expect(stageMilestone(stage)).toBeNull();
  });

  it("an empty, null, or unknown stage is no milestone", () => {
    expect(stageMilestone("")).toBeNull();
    expect(stageMilestone(null)).toBeNull();
    expect(stageMilestone(undefined)).toBeNull();
    expect(stageMilestone("some-custom-pipeline-stage")).toBeNull();
  });

  it("does not inherit milestones from Object.prototype", () => {
    // A prototype-chain lookup would make `stageMilestone("constructor")` truthy.
    expect(stageMilestone("constructor")).toBeNull();
    expect(stageMilestone("toString")).toBeNull();
  });
});
