"use client";

import { useEffect, useRef, useState } from "react";
import { createSupabaseBrowserClient } from "@/src/lib/supabase/client";

type Status = "idle" | "sending" | "sent" | "error";

const ERROR_ID = "login-error";

export function LoginForm() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // On a failed sign-in, move focus back to the field. The role="alert" below
  // announces the message to a screen reader; this stops a keyboard user being
  // stranded on the button with no idea the sign-in failed (WCAG 3.3.1 / 4.1.3).
  useEffect(() => {
    if (status === "error") inputRef.current?.focus();
  }, [status]);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("sending");
    setMessage("");
    try {
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo:
            typeof window !== "undefined"
              ? `${window.location.origin}/auth/callback`
              : undefined,
        },
      });
      if (error) {
        setStatus("error");
        setMessage(error.message);
        return;
      }
      setStatus("sent");
    } catch (err) {
      setStatus("error");
      setMessage(
        err instanceof Error ? err.message : "Sign-in is not configured yet.",
      );
    }
  }

  if (status === "sent") {
    return (
      <p className="text-sm text-zinc-600 dark:text-zinc-300">
        Check your email for a sign-in link.
      </p>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex w-full max-w-sm flex-col gap-3">
      <label htmlFor="email" className="text-sm font-medium">
        Work email
      </label>
      <input
        id="email"
        ref={inputRef}
        type="email"
        required
        aria-invalid={status === "error" || undefined}
        aria-describedby={status === "error" ? ERROR_ID : undefined}
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@company.com"
        className="rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
      />
      <button
        type="submit"
        disabled={status === "sending"}
        className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60 dark:bg-white dark:text-zinc-900"
      >
        {status === "sending" ? "Sending…" : "Send sign-in link"}
      </button>
      {status === "error" && (
        <p id={ERROR_ID} role="alert" className="text-sm text-red-600 dark:text-red-400">
          {message}
        </p>
      )}
    </form>
  );
}
