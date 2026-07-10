import { Card } from "@/design/components";
import { PromptCopyBox } from "@/design/components/prompt-copy-box";
import { SEQUENCE_SETUP } from "@/src/connect/setup-prompts";

/**
 * SequenceSetupHelp — HubSpot sub-step ② (Thread 08 · the zero-paste loop).
 *
 * The one send step no API can automate (HubSpot has no create-sequence endpoint).
 * Rather than hand the RevOps leader homework, we hand them a Claude-Chrome agent
 * prompt: it builds the dynamic sequence in their HubSpot AND writes the sequence
 * ID back into the "Sequence ID" field below (STEP D) — so they paste nothing.
 *
 * The prompt is delivered VERBATIM from `SEQUENCE_SETUP` (source of truth), tucked
 * in a collapsed disclosure so the card stays calm (8th-grade bar). Shown only
 * once HubSpot is connected — that's when the agent has a portal to work in.
 *
 * D9: this shows a PROMPT only. Nothing sends; the prompt itself tells the agent
 * to STOP before any send.
 */

const EXTENSION_URL =
  "https://support.anthropic.com/en/articles/12012173-getting-started-with-claude-for-chrome";

export function SequenceSetupHelp() {
  return (
    <Card variant="outlined" padding="lg">
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <span className="font-sans text-sm font-medium uppercase tracking-eyebrow text-ink-faint">
            Step 2
          </span>
          <h3 className="font-display text-h5 font-book text-ink">
            Set up your sequence
          </h3>
        </div>

        <p className="max-w-lg font-sans text-base text-ink-body">
          {SEQUENCE_SETUP.summary}
        </p>

        <details className="group flex flex-col gap-3">
          <summary className="w-fit cursor-pointer list-none font-sans text-base font-medium text-brand hover:text-brand-800">
            <span className="group-open:hidden">
              Let Claude set it up for you →
            </span>
            <span className="hidden group-open:inline">Hide the prompt</span>
          </summary>
          <div className="mt-3 flex flex-col gap-3">
            <PromptCopyBox
              prompt={SEQUENCE_SETUP.chromePrompt}
              copyLabel="Copy setup prompt"
            />
            <p className="font-sans text-sm text-ink-muted">
              Paste it into{" "}
              <a
                href={EXTENSION_URL}
                target="_blank"
                rel="noreferrer"
                className="underline hover:text-ink"
              >
                Claude in Chrome
              </a>
              , signed into HubSpot. It builds the sequence and fills the ID into
              the field below for you.
            </p>
          </div>
        </details>
      </div>
    </Card>
  );
}
