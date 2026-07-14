// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/**
 * A failed sign-in must be announced to assistive tech (COV-05, WCAG 3.3.1 / 4.1.3).
 * Before the fix the error <p> had no role, no programmatic link to the input, and
 * focus never moved — a screen-reader user was never told the login failed.
 */

const signInWithOtp = vi.fn();
vi.mock("@/src/lib/supabase/client", () => ({
  createSupabaseBrowserClient: () => ({ auth: { signInWithOtp } }),
}));

// Imported after the mock is registered.
const { LoginForm } = await import("@/app/login/login-form");

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("LoginForm", () => {
  it("announces a failed sign-in as a live alert wired to the input, and focuses the field", async () => {
    signInWithOtp.mockResolvedValue({ error: { message: "This email is not on the allowlist." } });
    const user = userEvent.setup();

    render(<LoginForm />);
    const input = screen.getByLabelText(/work email/i);
    await user.type(input, "nope@example.com");
    await user.click(screen.getByRole("button", { name: /send sign-in link/i }));

    // Announced: an assertive live region carries the message.
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("not on the allowlist");

    // Identified: the input is marked invalid and points at the error message.
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.getAttribute("aria-describedby")).toBe(alert.id);
    expect(alert.id).toBeTruthy();

    // Not stranded: focus lands on the field to correct.
    expect(document.activeElement).toBe(input);
  });

  it("marks the input valid and describes nothing before any error", () => {
    render(<LoginForm />);
    const input = screen.getByLabelText(/work email/i);
    expect(input.getAttribute("aria-invalid")).not.toBe("true");
    expect(input.getAttribute("aria-describedby")).toBeNull();
  });
});
