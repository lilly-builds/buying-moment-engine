import { describe, expect, it } from "vitest";
import { classifyFrontDeskRole } from "@/src/detectors/staffing-spike-classifier";

describe("classifyFrontDeskRole", () => {
  it.each([
    "Patient Coordinator",
    "Front Desk Receptionist",
    "Call Center Rep",
    "Patient Access Representative",
    "Front-Desk Scheduler",
  ])("fires for a front-desk title: %s", (title) => {
    const result = classifyFrontDeskRole(title);
    expect(result.isFrontDesk).toBe(true);
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
    expect(result.matchedPhrase).toBeTruthy();
  });

  it.each([
    "Registered Nurse",
    "Medical Assistant",
    "Nurse Practitioner",
    "Physician Assistant",
    "Dental Hygienist",
    "Veterinary Technician",
  ])("does NOT fire for a clinical title (precision guard): %s", (title) => {
    const result = classifyFrontDeskRole(title);
    expect(result.isFrontDesk).toBe(false);
    expect(result.confidence).toBe(0);
    expect(result.matchedPhrase).toBeUndefined();
  });

  it("does not fire for an unrelated title", () => {
    const result = classifyFrontDeskRole("Warehouse Associate");
    expect(result.isFrontDesk).toBe(false);
    expect(result.confidence).toBe(0);
  });

  it("matches phrases in the description when the title alone doesn't say it", () => {
    const result = classifyFrontDeskRole(
      "Team Member",
      "You'll staff our front desk and manage patient scheduling.",
    );
    expect(result.isFrontDesk).toBe(true);
    expect(result.matchedPhrase).toBe("front desk");
  });

  it("does not exclude a front-desk posting whose description mentions clinical coworkers", () => {
    // The exclusion guard checks the TITLE only — a legitimate front-desk
    // posting shouldn't be suppressed just because its description mentions
    // clinical staff it supports.
    const result = classifyFrontDeskRole(
      "Front Desk Coordinator",
      "Supports our Nurse Practitioner and physicians with scheduling.",
    );
    expect(result.isFrontDesk).toBe(true);
  });

  it("picks the highest-confidence phrase when multiple match", () => {
    const result = classifyFrontDeskRole("Front Desk Scheduler");
    expect(result.isFrontDesk).toBe(true);
    expect(result.matchedPhrase).toBe("front desk");
    expect(result.confidence).toBe(0.9);
  });

  it("is case-insensitive", () => {
    const result = classifyFrontDeskRole("FRONT DESK RECEPTIONIST");
    expect(result.isFrontDesk).toBe(true);
  });
});
