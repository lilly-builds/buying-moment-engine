import { KEY_SETUPS } from "@/src/connect/setup-prompts";
import { PromptCopyBox } from "@/design/components/prompt-copy-box";

/**
 * KeySetupHelp — the collapsed "Don't have a key yet?" disclosure under each
 * engine-key field (Thread 08 · wire-key handoff). Two ways, always:
 *   (a) "Let Claude get it for you" — the verbatim Claude-Chrome prompt + Copy,
 *       the sign-in note, and the extension-install link.
 *   (b) "Or do it yourself" — the manual steps.
 *
 * The prompt is rendered VERBATIM from KEY_SETUPS (the source of truth) — the
 * "never read/copy/type the key" line inside it is a load-bearing safety
 * contract, so it's never retyped here. Collapsed by default so it never crowds
 * someone who already has a key; the paste field above stays the primary action.
 */

const EXTENSION_URL =
  "https://support.anthropic.com/en/articles/12012173-getting-started-with-claude-for-chrome";

export function KeySetupHelp({ provider }: { provider: "anthropic" | "pdl" }) {
  const setup = KEY_SETUPS[provider];
  return (
    <details className="group flex flex-col border-t border-line pt-4">
      <summary className="w-fit cursor-pointer list-none font-sans text-sm font-medium text-brand hover:text-brand-800">
        <span className="group-open:hidden">Don&apos;t have a key yet?</span>
        <span className="hidden group-open:inline">Hide setup help</span>
      </summary>

      <div className="mt-4 flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <h4 className="font-sans text-sm font-semibold text-ink-strong">
            Let Claude get it for you
          </h4>
          <PromptCopyBox prompt={setup.chromePrompt} />
          <p className="font-sans text-sm text-ink-muted">{setup.signIn}</p>
          <p className="font-sans text-sm text-ink-muted">
            New to this?{" "}
            <a
              href={EXTENSION_URL}
              target="_blank"
              rel="noreferrer"
              className="underline hover:text-ink"
            >
              Get Claude in Chrome
            </a>
            , then paste the prompt above.
          </p>
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
