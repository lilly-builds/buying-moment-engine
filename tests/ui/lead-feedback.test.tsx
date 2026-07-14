// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LeadFeedback } from "@/design/components/brief/lead-feedback";

/**
 * The AE thumbs-up/down vote now persists (COV-11). Before, it was client-state only.
 */

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("LeadFeedback", () => {
  it("POSTs the vote to /api/feedback and confirms it saved", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<LeadFeedback practiceId="11111111-1111-1111-1111-111111111111" />);
    await user.click(screen.getByRole("button", { name: "Good lead" }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/feedback");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toMatchObject({
      practiceId: "11111111-1111-1111-1111-111111111111",
      thumb: "up",
    });
    expect(await screen.findByText(/teaches the tool/i)).toBeTruthy();
  });

  it("ignores taps while a save is in flight, so the UI can't diverge from the DB", async () => {
    let resolveFetch: (v: Response) => void = () => {};
    const fetchMock = vi.fn().mockReturnValue(
      new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<LeadFeedback practiceId="11111111-1111-1111-1111-111111111111" />);
    await user.click(screen.getByRole("button", { name: "Good lead" }));

    // Mid-save: both buttons are disabled, so a second tap fires no second request.
    expect((screen.getByRole("button", { name: "Good lead" }) as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByRole("button", { name: "Not a good lead" }));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolveFetch(new Response(JSON.stringify({ ok: true }), { status: 200 }));
  });

  it("shows an honest error when saving fails, and does not falsely claim success", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("boom", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<LeadFeedback practiceId="11111111-1111-1111-1111-111111111111" />);
    await user.click(screen.getByRole("button", { name: "Not a good lead" }));

    expect(await screen.findByText(/could not save/i)).toBeTruthy();
    expect(screen.queryByText(/teaches the tool/i)).toBeNull();
  });
});
