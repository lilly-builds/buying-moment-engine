import { describe, expect, it } from "vitest";
import { classifyBuyerTier, selectBestContact } from "@/src/enrich/contact-ranking";

describe("coverage-first contact ranking", () => {
  it("classifies buyer tiers honestly", () => {
    expect(classifyBuyerTier("Founder and CEO")).toBe("A");
    expect(classifyBuyerTier("Practice Manager")).toBe("B");
    expect(classifyBuyerTier("Billing Manager")).toBe("C");
    expect(classifyBuyerTier("Scheduling Coordinator")).toBe("D");
    expect(classifyBuyerTier("Physician")).toBe("E");
    expect(classifyBuyerTier("Marketing Intern")).toBe("X");
  });

  it("prefers the best buyer but still chooses a real fallback over no contact", () => {
    const selected = selectBestContact([
      { name: "Sam Scheduler", role: "Scheduling Coordinator", sourceProvider: "prospeo" },
      { name: "Dana Owner", role: "Owner", sourceProvider: "fullenrich" },
    ]);
    expect(selected?.candidate.name).toBe("Dana Owner");
    expect(selected?.tier).toBe("A");

    const fallback = selectBestContact([
      { name: "Olivia Office", role: "Office Manager", sourceProvider: "prospeo" },
    ]);
    expect(fallback?.candidate.name).toBe("Olivia Office");
    expect(fallback?.classification).toBe("reachable_fallback");
  });

  it("deprioritizes unrelated sales/marketing contacts", () => {
    const selected = selectBestContact([
      { name: "Mark Vendor", role: "Sales Manager", sourceProvider: "prospeo" },
      { name: "Casey Clinic", role: "Clinic Manager", sourceProvider: "prospeo" },
    ]);
    expect(selected?.candidate.name).toBe("Casey Clinic");
  });
});
