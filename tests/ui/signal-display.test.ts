import { describe, expect, it } from "vitest";
import { gradientTokens } from "@/design/tokens";
import { DETECTOR_KINDS } from "@/src/ingest/validate";
import { PACK_VERTICALS } from "@/src/packs";
import {
  toSignalKind,
  toSignalKinds,
  toVerticalSlug,
  VERTICAL_FILTERS,
} from "@/src/ui/signal-display";

describe("DB enum -> design kit vocabulary", () => {
  it("maps every built detector kind to a kind the design kit can paint", () => {
    for (const kind of ["staffing_spike", "phone_complaints", "growth_events"] as const) {
      const pill = toSignalKind(kind);
      expect(pill).not.toBeNull();
      // The real assertion: the mapped value indexes a REAL gradient token. A kind
      // that maps to a string with no gradient renders `background: var(--…)` with an
      // undefined var — a white pill on a white card.
      expect(gradientTokens[`--gradient-signal-${pill!}`]).toBeTruthy();
    }
  });

  it("maps `regulation` to null rather than a gradient-less pill", () => {
    // spec D3: regulation is research-gated and has no detector built, so it has no
    // colour in the vocabulary. `--gradient-signal-regulation` does not exist. If this
    // ever returns a string, SignalPill paints white-on-white and the AE loses the one
    // element that says WHY to call.
    expect(toSignalKind("regulation")).toBeNull();
    expect(gradientTokens).not.toHaveProperty("--gradient-signal-regulation");
  });

  it("is total over DetectorKind — a new kind cannot silently fall through", () => {
    for (const kind of DETECTOR_KINDS) {
      const pill = toSignalKind(kind);
      // Either a paintable kind, or an explicit null. Never `undefined`, which is what
      // a missing Record entry returns and what a `?.` would swallow.
      expect(pill === null || typeof pill === "string").toBe(true);
      expect(pill).not.toBeUndefined();
      if (pill !== null)
        expect(gradientTokens[`--gradient-signal-${pill}`]).toBeTruthy();
    }
  });

  it("drops unpaintable kinds from a pill list instead of rendering a blank", () => {
    expect(
      toSignalKinds(["staffing_spike", "regulation", "growth_events"]),
    ).toEqual(["staffing-spike", "growth-events"]);
  });

  it("preserves caller order", () => {
    expect(toSignalKinds(["growth_events", "staffing_spike"])).toEqual([
      "growth-events",
      "staffing-spike",
    ]);
  });
});

describe("vertical slugs", () => {
  it("kebab-cases the one vertical that needs it", () => {
    expect(toVerticalSlug("womens_health")).toBe("womens-health");
  });

  it("is total over PACK_VERTICALS", () => {
    for (const vertical of PACK_VERTICALS) {
      expect(toVerticalSlug(vertical)).toBeTruthy();
    }
  });

  it("derives one filter per pack, plus All — a fifth pack cannot ship invisible", () => {
    expect(VERTICAL_FILTERS).toHaveLength(PACK_VERTICALS.length + 1);
    expect(VERTICAL_FILTERS[0]).toEqual({ value: "all", label: "All" });
    expect(VERTICAL_FILTERS.map((f) => f.value)).toContain("womens-health");
  });

  it("never emits a snake_case value into the UI", () => {
    for (const filter of VERTICAL_FILTERS) {
      expect(filter.value).not.toContain("_");
    }
  });
});
