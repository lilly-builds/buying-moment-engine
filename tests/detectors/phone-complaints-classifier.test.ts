import { describe, expect, it } from "vitest";
import { classifyPhoneComplaint } from "@/src/detectors/phone-complaints-classifier";

describe("classifyPhoneComplaint", () => {
  it.each([
    "I can't get through no matter how many times I call.",
    "This place is great in person but always on hold whenever you call.",
    "No one ever answers the phone here.",
    "Left on hold 20 minutes then they hung up on me.",
    "The phone rings and rings, nobody ever picks up.",
    "It's impossible to reach by phone, I tried for a week.",
  ])("flags an acute phone-access complaint: %s", (text) => {
    const result = classifyPhoneComplaint(text);
    expect(result.isPhoneComplaint).toBe(true);
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
    expect(result.category).toBeTruthy();
  });

  it.each([
    "I called and the staff were lovely, got me in same day.",
    "Best dermatologist in town, highly recommend!",
    "Friendly front desk and short wait times.",
  ])("does NOT flag a positive review that merely mentions the phone/visit: %s", (text) => {
    const result = classifyPhoneComplaint(text);
    expect(result.isPhoneComplaint).toBe(false);
    expect(result.confidence).toBe(0);
    expect(result.category).toBeUndefined();
  });

  it("does not fire for an unrelated review", () => {
    const result = classifyPhoneComplaint("The parking lot was a little small but otherwise fine.");
    expect(result.isPhoneComplaint).toBe(false);
    expect(result.confidence).toBe(0);
  });

  it("is case-insensitive", () => {
    const result = classifyPhoneComplaint("I CAN'T GET THROUGH ON THE PHONE");
    expect(result.isPhoneComplaint).toBe(true);
  });

  it("picks the highest-confidence phrase when multiple match", () => {
    const result = classifyPhoneComplaint(
      "Impossible to reach by phone — impossible to reach at all.",
    );
    expect(result.category).toBe("cannot-get-through");
    expect(result.confidence).toBe(0.9);
  });
});
