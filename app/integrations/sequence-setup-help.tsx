import { PromptCopyBox } from "@/design/components/prompt-copy-box";
import { SEQUENCE_SETUP } from "@/src/connect/setup-prompts";

/**
 * SequenceSetupHelp — HubSpot sub-step ② (Thread 08 · the zero-paste loop).
 *
 * The one send step no API can automate (HubSpot has no create-sequence endpoint).
 * Rather than hand the RevOps leader homework, we hand them a Claude-for-Chrome
 * agent prompt: it builds the dynamic sequence in their HubSpot AND writes the
 * sequence ID back into the "Sequence ID" field below (STEP D) — so they paste nothing.
 *
 * The prompt is delivered VERBATIM from `SEQUENCE_SETUP` (source of truth), with
 * plain numbered how-to steps around it so the card stays calm (8th-grade bar).
 * Shown only once HubSpot is connected — that's when the agent has a portal to work in.
 *
 * D9: this shows a PROMPT only. Nothing sends; the prompt itself tells the agent
 * to STOP before any send.
 */

const EXTENSION_URL =
  "https://support.anthropic.com/en/articles/12012173-getting-started-with-claude-for-chrome";

export function SequenceSetupHelp() {
  // No Card wrapper — this is a sub-step inside the HubSpot ConnectionRow card.
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <span className="font-sans text-sm font-medium uppercase tracking-eyebrow text-ink-faint">
          Step 2
        </span>
        <h3 className="font-display text-lg font-book text-ink">
          Set up your sequence
        </h3>
      </div>

      <p className="font-sans text-base text-ink-body">{SEQUENCE_SETUP.summary}</p>

      <details className="group flex flex-col">
        {/* A prominent purple (primary) button so it's the obvious thing to click. */}
        <summary className="inline-flex w-fit cursor-pointer list-none items-center gap-2 rounded-control bg-brand px-6 py-3 font-sans text-base font-book tracking-control text-white transition-colors duration-150 hover:bg-brand-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand [&::-webkit-details-marker]:hidden">
          <span className="group-open:hidden">
            Let Claude for Chrome set it up for you →
          </span>
          <span className="hidden group-open:inline">Hide the prompt</span>
        </summary>
        <div className="mt-3 flex flex-col gap-4">
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
            <li>Open HubSpot in Chrome and sign in.</li>
            <li>
              Open the extension: click the Claude icon in your browser&apos;s top
              toolbar (top right, it looks like the Claude logo). Sign in if it asks.
            </li>
            <li>Copy the prompt below and paste it into the Claude for Chrome panel.</li>
            <li>
              It builds your sequence and fills in the sequence ID in the field below
              for you. You do not paste anything else.
            </li>
          </ol>
          <PromptCopyBox
            prompt={SEQUENCE_SETUP.chromePrompt}
            copyLabel="Copy setup prompt"
          />
        </div>
      </details>
    </div>
  );
}
