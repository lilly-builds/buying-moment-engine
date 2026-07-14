// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { IncumbentToolingPanel, ProofPointPanel } from "@/app/brief-view";

/**
 * Brief-screen honesty/empty-state render bugs (E2E-02, E2E-03).
 * E2E-02: a "Measured" badge must never sit over a "Proof pending" body (D10: never
 * dress an absence up as a measurement).
 * E2E-03: the incumbent-tooling card must not be a bare heading over blank space.
 */

afterEach(cleanup);

const realProof = {
  tag: "real" as const,
  caseStudy: "Cut phone hold times 40%",
  metrics: ["-40% average hold time"],
  sourceUrl: "https://example.com/story",
  href: "https://example.com/story",
};

describe("ProofPointPanel (E2E-02)", () => {
  it("does NOT show a 'Measured' badge when the proof is pending", () => {
    render(<ProofPointPanel proofPoint={{ tag: "proof_pending" }} />);
    expect(screen.getByText(/proof pending/i)).toBeTruthy();
    expect(screen.queryByText("Measured")).toBeNull();
  });

  it("shows 'Measured' with the case study when the proof is real (positive control)", () => {
    render(<ProofPointPanel proofPoint={realProof} />);
    expect(screen.getByText("Measured")).toBeTruthy();
    expect(screen.getByText(/cut phone hold times/i)).toBeTruthy();
  });
});

describe("IncumbentToolingPanel (E2E-03)", () => {
  it("shows an honest empty state instead of a bare heading when there is no tooling", () => {
    render(<IncumbentToolingPanel tooling={[]} />);
    expect(screen.getByText(/no incumbent/i)).toBeTruthy();
  });

  it("renders the tooling rows when present (positive control)", () => {
    render(
      <IncumbentToolingPanel
        tooling={[
          {
            label: "Phone system",
            value: "RingCentral",
            quote: null,
            href: "https://x.example",
            evidenceId: "ev-1",
            sourceUrl: "https://x.example",
          },
        ]}
      />,
    );
    expect(screen.getByText("RingCentral")).toBeTruthy();
    expect(screen.queryByText(/no incumbent/i)).toBeNull();
  });
});
