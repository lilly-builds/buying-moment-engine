import { describe, expect, it } from "vitest";
import { ELISEAI_DEFAULT } from "@/src/workspace/default";
import { WorkspaceConfigSchema } from "@/src/workspace/schema";

describe("WorkspaceConfigSchema", () => {
  it("validates the EliseAI default workspace", () => {
    const result = WorkspaceConfigSchema.safeParse(ELISEAI_DEFAULT);
    expect(result.success).toBe(true);
  });

  it("accepts empty proof and sampleFeed arrays", () => {
    const config = {
      ...ELISEAI_DEFAULT,
      proof: [],
      sampleFeed: [],
    };
    const result = WorkspaceConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
  });

  it("rejects a brand color that is not a #rrggbb hex", () => {
    const config = {
      ...ELISEAI_DEFAULT,
      brand: { ...ELISEAI_DEFAULT.brand, primaryColor: "purple" },
    };
    const result = WorkspaceConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
    if (!result.success) {
      const path = result.error.issues[0]?.path.join(".");
      expect(path).toBe("brand.primaryColor");
    }
  });

  it("rejects a 3-digit hex shorthand (#fff is not #rrggbb)", () => {
    const config = {
      ...ELISEAI_DEFAULT,
      brand: { ...ELISEAI_DEFAULT.brand, accentColor: "#fff" },
    };
    expect(WorkspaceConfigSchema.safeParse(config).success).toBe(false);
  });

  it("rejects a proof point that is neither the real shape nor the pending sentinel", () => {
    const config = {
      ...ELISEAI_DEFAULT,
      proof: [{ claim: "Some result" }],
    };
    expect(WorkspaceConfigSchema.safeParse(config).success).toBe(false);
  });

  it("accepts the pending-proof sentinel", () => {
    const config = {
      ...ELISEAI_DEFAULT,
      proof: [{ claim: "No proof yet", tag: "pending" as const }],
    };
    expect(WorkspaceConfigSchema.safeParse(config).success).toBe(true);
  });

  it("rejects a missing required field (business.oneLiner)", () => {
    const { oneLiner: _oneLiner, ...rest } = ELISEAI_DEFAULT.business;
    const config = { ...ELISEAI_DEFAULT, business: rest };
    expect(WorkspaceConfigSchema.safeParse(config).success).toBe(false);
  });
});
