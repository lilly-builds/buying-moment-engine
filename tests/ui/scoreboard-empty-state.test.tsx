// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ScoreboardEmptyNote, ScoreboardView } from "@/app/scoreboard-view";
import { demoScoreboard } from "@/app/styleguide/demo-fixtures";

// TopNav (rendered inside ScoreboardView) reads the route via next/navigation. Stub it so
// the full board renders in jsdom and we can prove the empty-note wiring in context.
vi.mock("next/navigation", () => ({ usePathname: () => "/scoreboard" }));

/**
 * The honest empty scoreboard (E2E-01). The live board excludes seeded demo rows (D9),
 * so a real system with no measured outcomes yet reads all-zero. It must SAY so — a
 * titled dashboard of zeros with no explanation reads as broken, and the seeded numbers
 * must never be dropped in to make it look busier (that would render fabricated ROI as
 * measured). `hasMeasuredData` on the populated demo board is the positive control.
 */

afterEach(cleanup);

describe("ScoreboardEmptyNote (E2E-01)", () => {
  it("states the board is honestly empty, not broken", () => {
    render(<ScoreboardEmptyNote />);
    expect(screen.getByText(/no measured outcomes yet/i)).toBeTruthy();
  });
});

describe("hasMeasuredData flag (E2E-01)", () => {
  it("is true for the populated styleguide demo board (positive control)", () => {
    expect(demoScoreboard().hasMeasuredData).toBe(true);
  });
});

describe("ScoreboardView wires the empty note to the flag (E2E-01)", () => {
  // Only `hasMeasuredData` differs between the two renders, so this isolates the
  // `{!data.hasMeasuredData && <ScoreboardEmptyNote/>}` wiring in the assembled board.
  const populated = demoScoreboard();
  const empty = { ...populated, hasMeasuredData: false };

  it("shows the honest note when the board has no measured data", () => {
    render(<ScoreboardView data={empty} />);
    expect(screen.getByText(/no measured outcomes yet/i)).toBeTruthy();
  });

  it("hides the note when the board has measured data (positive control)", () => {
    render(<ScoreboardView data={populated} />);
    expect(screen.queryByText(/no measured outcomes yet/i)).toBeNull();
  });
});
