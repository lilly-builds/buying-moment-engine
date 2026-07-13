import { KEY_SETUPS } from "@/src/connect/setup-prompts";
import { PromptCopyBox } from "@/design/components/prompt-copy-box";

/**
 * KeySetupHelp — a "Get help finding your key" button under each engine-key
 * field (Thread 08 · wire-key handoff) that opens to two ways, always:
 *   (a) "Let Claude for Chrome get it for you" — plain numbered steps (install the
 *       Claude for Chrome extension, sign in, paste the prompt) around the verbatim
 *       Claude-Chrome prompt + Copy. Copy names the browser EXTENSION explicitly so
 *       a non-technical owner doesn't confuse it with the regular Claude app.
 *   (b) "Or do it yourself" — the manual steps.
 *
 * The prompt is rendered VERBATIM from KEY_SETUPS (the source of truth) — the
 * "never read/copy/type the key" line inside it is a load-bearing safety
 * contract, so it's never retyped here. It's a `<details>` so the trigger is a
 * real, keyboard-accessible button that announces expanded/collapsed; collapsed
 * by default so it never crowds someone who already has a key — the paste field
 * above stays the primary action.
 */

const EXTENSION_URL =
  "https://support.anthropic.com/en/articles/12012173-getting-started-with-claude-for-chrome";

export function KeySetupHelp({ provider }: { provider: "anthropic" | "pdl" }) {
  const setup = KEY_SETUPS[provider];
  return (
    <details className="group flex flex-col border-t border-line pt-4">
      {/* A prominent purple (primary) button so it's easy to spot and click. */}
      <summary className="inline-flex w-fit cursor-pointer list-none items-center gap-2 rounded-control bg-brand px-6 py-3 font-sans text-base font-book tracking-control text-white transition-colors duration-150 hover:bg-brand-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand [&::-webkit-details-marker]:hidden">
        <span className="group-open:hidden">Get help finding your key</span>
        <span className="hidden group-open:inline">Hide help</span>
      </summary>

      <div className="mt-4 flex flex-col gap-6">
        <div className="flex flex-col gap-3">
          <h4 className="font-sans text-sm font-semibold text-ink-strong">
            Let Claude for Chrome get it for you
          </h4>
          <ol className="flex list-decimal flex-col gap-2 pl-5 font-sans text-sm text-ink-body">
            <li>
              Install the{" "}
              <a
                href={EXTENSION_URL}
                target="_blank"
                rel="noreferrer"
                className="font-medium text-brand underline hover:text-brand-800"
              >
                Claude for Chrome
              </a>{" "}
              browser extension. This is the one that works inside Chrome, not the
              regular Claude app.
            </li>
            <li>
              Open the extension: click the Claude icon in your browser&apos;s top
              toolbar (top right, it looks like the Claude logo). Sign in if it asks.
            </li>
            <li>Copy the prompt below and paste it into the Claude for Chrome panel.</li>
            <li>
              It guides you to the exact page and buttons. You create your key, copy
              it, and paste it in the box above. Claude never sees or touches your key.
            </li>
          </ol>
          <PromptCopyBox prompt={setup.chromePrompt} />
          <p className="font-sans text-sm text-ink-muted">{setup.signIn}</p>
        </div>

        <div className="flex flex-col gap-2">
          <h4 className="font-sans text-sm font-semibold text-ink-strong">
            Or do it yourself
          </h4>
          <ol className="flex list-decimal flex-col gap-1.5 pl-5 font-sans text-sm text-ink-body">
            {setup.manualSteps.map((step, i) => (
              <li key={i}>{step}</li>
            ))}
          </ol>
        </div>
      </div>
    </details>
  );
}
