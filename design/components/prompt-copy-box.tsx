"use client";

import { useState } from "react";
import { Button } from "@/design/components";

/**
 * PromptCopyBox — a read-only, self-scrolling box holding a copy-paste prompt +
 * a "Copy" button (Thread 08). Shared by the key-setup help and the sequence-
 * setup help so both render their (verbatim) prompts identically.
 *
 * SAFETY: this only ever shows and copies a PROMPT — never a secret. The prompt
 * text is passed in from a verbatim source-of-truth constant (KEY_SETUPS /
 * SEQUENCE_SETUP); this component never edits it. It scrolls INSIDE itself
 * (`max-h` + `overflow-auto`, `whitespace-pre-wrap`) so a long prompt never
 * grows the card unbounded or scrolls the page sideways.
 */
export function PromptCopyBox({
  prompt,
  copyLabel = "Copy prompt",
}: {
  prompt: string;
  copyLabel?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked (insecure context / denied) — the text stays visible
      // and selectable, so the user can copy it by hand. No error surfaced.
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-panel bg-surface-subtle p-4 font-mono text-sm leading-relaxed text-ink-body">
        {prompt}
      </pre>
      <div>
        <Button type="button" variant="secondary" size="sm" onClick={copy}>
          {copied ? "Copied ✓" : copyLabel}
        </Button>
      </div>
    </div>
  );
}
