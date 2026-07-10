"use client";

import { useState } from "react";
import { Button, Input } from "@/design/components";
import { KEY_SETUPS } from "@/src/connect/setup-prompts";
import { KeySetupHelp } from "./key-setup-help";

/**
 * The two paste-a-key engine credentials (spec § Stack), lifted out of
 * integrations-view so the page file stays readable and each card owns its own
 * masked field + "Don't have a key yet?" help. A key reads "set" when a real key
 * is stored OR the env fallback is present (the keyless demo).
 */

export type KeyProviderId = "anthropic" | "pdl";

export interface EngineKeyMeta {
  id: KeyProviderId;
  name: string;
  /** What this key powers, in one plain line. */
  blurb: string;
  /** Where to get the key — the inline RevOps step (matches KEY_SETUPS). */
  where: string;
  /** A real, clickable link to the provider's key page (matches KEY_SETUPS.keyUrl). */
  href: string;
  /** Placeholder that hints the real key shape without leaking one. */
  placeholder: string;
}

/** The link (`href`) is sourced from KEY_SETUPS[*].keyUrl — the ONE verified
 *  source of truth (checked against the live dashboards 2026-07-10) — so the
 *  field link and the help prompt can never drift to different URLs. */
export const ENGINE_KEYS: EngineKeyMeta[] = [
  {
    id: "anthropic",
    name: "Anthropic (Claude)",
    blurb: "Researches each prospect and writes the brief.",
    where: "Claude Console → Create key.",
    href: KEY_SETUPS.anthropic.keyUrl,
    placeholder: "sk-ant-…",
  },
  {
    id: "pdl",
    name: "People Data Labs",
    blurb: "Finds the decision-maker's verified email + LinkedIn.",
    where: "PDL dashboard → My API Key → Copy.",
    href: KEY_SETUPS.pdl.keyUrl,
    placeholder: "Paste your PDL key",
  },
];

type KeySubmitState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved" }
  | { kind: "error"; message: string };

/**
 * One engine-key row: a masked paste field that saves the key to the encrypted,
 * server-only store (`POST /api/provider-keys`). The key is `type="password"` so
 * it's never shoulder-surfable, and the field CLEARS on save — the browser never
 * holds or re-displays the secret. The pill reflects whether a key is set (stored
 * or env); a fresh save flips it to "Set" without a reload. A collapsed "Don't
 * have a key yet?" help sits below the form (KeySetupHelp).
 */
export function EngineKeyCard({
  meta,
  initiallySet,
}: {
  meta: EngineKeyMeta;
  initiallySet: boolean;
}) {
  const [key, setKey] = useState("");
  const [set, setSet] = useState(initiallySet);
  const [status, setStatus] = useState<KeySubmitState>({ kind: "idle" });

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = key.trim();
    if (trimmed.length === 0) {
      setStatus({ kind: "error", message: "Paste a key first." });
      return;
    }
    setStatus({ kind: "saving" });
    try {
      const res = await fetch("/api/provider-keys", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider: meta.id, key: trimmed }),
        // Don't FOLLOW the session gate's redirect to /login — a followed 307
        // lands on a 200 HTML page that would masquerade as a saved key. `manual`
        // surfaces the redirect as an opaque response instead.
        redirect: "manual",
      });

      if (res.type === "opaqueredirect" || res.status === 0) {
        setStatus({
          kind: "error",
          message: "Your session expired. Please refresh the page and try again.",
        });
        return;
      }

      const body = (await res.json().catch(() => null)) as {
        ok?: boolean;
        present?: boolean;
        error?: string;
      } | null;

      // Success requires a real `{ ok: true }` — never just a 200.
      if (!res.ok || body?.ok !== true) {
        setStatus({
          kind: "error",
          message: body?.error ?? "Couldn't save your key. Please try again.",
        });
        return;
      }

      setSet(true);
      setKey(""); // never keep the secret in the field
      setStatus({ kind: "saved" });
    } catch {
      setStatus({
        kind: "error",
        message: "Couldn't reach the server. Please try again.",
      });
    }
  }

  const inputId = `key-${meta.id}`;
  // No Card wrapper or heading here — the ConnectionRow that hosts this IS the
  // card and carries the name (its bold line), the blurb (its detail), and the
  // Set/Not-yet pill. This renders only the action: the masked field + help.
  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={onSubmit} className="flex flex-col gap-2">
        <label htmlFor={inputId} className="font-sans text-sm font-medium text-ink-strong">
          {set ? "Replace key" : "Paste key"}{" "}
          <span className="font-normal text-ink-faint">
            ·{" "}
            <a
              href={meta.href}
              target="_blank"
              rel="noreferrer"
              className="underline hover:text-ink-muted"
            >
              {meta.where}
            </a>
          </span>
        </label>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <Input
            id={inputId}
            name={inputId}
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder={meta.placeholder}
            autoComplete="off"
            spellCheck={false}
            maxLength={512}
          />
          <Button
            type="submit"
            variant={set ? "secondary" : "primary"}
            disabled={status.kind === "saving"}
            className="shrink-0"
          >
            {status.kind === "saving" ? "Saving…" : set ? "Replace" : "Save key"}
          </Button>
        </div>
        {status.kind === "saved" ? (
          <p role="status" className="font-sans text-sm text-success-ink">
            Saved. {meta.name} is set.
          </p>
        ) : null}
        {status.kind === "error" ? (
          <p role="alert" className="font-sans text-sm text-danger">
            {status.message}
          </p>
        ) : null}
      </form>

      <KeySetupHelp provider={meta.id} />
    </div>
  );
}
