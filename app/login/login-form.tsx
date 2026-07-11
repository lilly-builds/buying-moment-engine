"use client";

import { useState } from "react";
import { Button, Input } from "@/design/components";
import { createSupabaseBrowserClient } from "@/src/lib/supabase/client";

type Status = "idle" | "sending" | "sent" | "error";

export function LoginForm() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("");

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
      <div className="flex flex-col items-center gap-1 rounded-panel border border-success bg-success-surface px-4 py-4 text-center">
        <p className="font-sans text-sm font-medium text-success-ink">
          Check your email
        </p>
        <p className="font-sans text-sm text-ink-muted">
          We sent a sign-in link to {email}.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex w-full flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="email" className="font-sans text-sm font-medium text-ink">
          Work email
        </label>
        <Input
          id="email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@company.com"
        />
      </div>
      <Button
        type="submit"
        variant="primary"
        size="md"
        disabled={status === "sending"}
        className="w-full"
      >
        {status === "sending" ? "Sending…" : "Send sign-in link"}
      </Button>
      {status === "error" && (
        <p className="font-sans text-sm text-danger">{message}</p>
      )}
    </form>
  );
}
