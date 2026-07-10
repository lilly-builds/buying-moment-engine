"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Badge,
  Button,
  ButtonLink,
  Card,
  Input,
  PageContainer,
  SectionHeader,
  Textarea,
  TopNav,
} from "@/design/components";
import { gradients } from "@/design/tokens";
import type { RevOpsOwner } from "@/src/target/config";
import { ValueOpener } from "./value-opener";

/**
 * Integrations / Connections (U17) — where the tool binds to the stack the JD
 * names (R1). HubSpot is the first and only CRM the engine actually connects (§
 * Stack, D11): one OAuth grant covers CRM push + tag + track (and send, when the
 * portal grants it). Everything else is an honest "request it" — captured as a
 * real demand signal, never a dead button.
 *
 * Surface matches the feed and the scoreboard: the health-blue hero paints the
 * whole page and the working panels are white cards floating on it. The HubSpot
 * card is `elevated` because it is the ONE thing on the page that acts; the
 * request card is `outlined`, a calmer second surface (design/rules.ts: elevation
 * lifts one thing, not a list).
 */

/** The official HubSpot sprocket, inline so it stays crisp and needs no request.
 *  Brand orange is a logo asset, not a design token — the one hex the page owns. */
function HubSpotMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="#FF7A59"
      role="img"
      aria-label="HubSpot"
    >
      <path d="M18.164 7.93V5.084a2.198 2.198 0 001.267-1.978v-.067A2.2 2.2 0 0017.238.845h-.067a2.2 2.2 0 00-2.193 2.193v.067a2.196 2.196 0 001.252 1.973l.013.006v2.852a6.22 6.22 0 00-2.969 1.31l.012-.01-7.828-6.095A2.497 2.497 0 104.3 4.656l-.012.006 7.697 5.991a6.176 6.176 0 00-1.038 3.446c0 1.343.425 2.588 1.147 3.607l-.013-.02-2.342 2.343a1.968 1.968 0 00-.58-.095h-.002a2.033 2.033 0 102.033 2.033 1.978 1.978 0 00-.1-.595l.005.014 2.317-2.317a6.247 6.247 0 104.782-11.134l-.036-.005zm-.964 9.378a3.206 3.206 0 113.215-3.207v.002a3.206 3.206 0 01-3.207 3.207z" />
    </svg>
  );
}

export type HubSpotStatus =
  // The per-connection sequence id (null until the user pastes it after sequence
  // setup) drives the "finish setup" field below the connect card.
  | { state: "connected"; sequenceId: string | null }
  // `ambiguous` (two portals on file) is folded in here: Connect/Reconnect still
  // works, and the ops fix is to disconnect one — an edge the demo never hits.
  | { state: "disconnected" };

export type ConnectBanner =
  | { kind: "connected" }
  | { kind: "error"; code: string };

const ERROR_COPY: Record<string, string> = {
  not_configured:
    "HubSpot isn't set up on this environment yet — the connection keys are still to come.",
  connect_failed:
    "That HubSpot connection didn't go through. Please try connecting again.",
};

function errorMessage(code: string): string {
  return (
    ERROR_COPY[code] ?? "Something went wrong connecting. Please try again."
  );
}

// ── Post-OAuth banner ─────────────────────────────────────────────────────────

function ConnectResultBanner({ banner }: { banner: ConnectBanner }) {
  const connected = banner.kind === "connected";
  return (
    <div
      role="status"
      className={
        connected
          ? "flex items-center gap-3 rounded-panel border border-success bg-success-surface px-4 py-3"
          : "flex items-center gap-3 rounded-panel border border-warn bg-warn-surface px-4 py-3"
      }
    >
      <span
        aria-hidden
        className={
          connected
            ? "size-2 shrink-0 rounded-pill bg-success-ink"
            : "size-2 shrink-0 rounded-pill bg-warn"
        }
      />
      <p
        className={
          connected
            ? "font-sans text-base text-success-ink"
            : "font-sans text-base text-warn"
        }
      >
        {connected
          ? "HubSpot is connected. Surfaced leads will push, tag, and track here."
          : errorMessage(banner.kind === "error" ? banner.code : "")}
      </p>
      <Link
        href="/integrations"
        aria-label="Dismiss"
        className="ml-auto rounded-control px-2 font-sans text-lg leading-none text-ink-muted hover:text-ink"
      >
        ×
      </Link>
    </div>
  );
}

// ── The HubSpot connect card ───────────────────────────────────────────────────

function HubSpotCard({ status }: { status: HubSpotStatus }) {
  const connected = status.state === "connected";
  return (
    <Card variant="elevated" padding="lg">
      <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <span className="flex size-20 shrink-0 items-center justify-center rounded-panel bg-surface-subtle">
            <HubSpotMark className="size-12" />
          </span>

          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-3">
              <h3 className="font-display text-h5 font-book text-ink">HubSpot</h3>
              {connected ? (
                <Badge tone="success" size="sm">
                  Connected
                </Badge>
              ) : null}
            </div>

            <p className="max-w-md font-sans text-base text-ink-body">
              Track prospects that GTM Maestro finds in your HubSpot. Send
              AI-customized outreach emails.
            </p>
          </div>
        </div>

        <div className="shrink-0 sm:pl-4">
          {connected ? (
            <ButtonLink
              href="/api/hubspot/oauth/start"
              variant="secondary"
              className="w-full sm:w-auto"
            >
              Reconnect
            </ButtonLink>
          ) : (
            // A real top-level navigation (not fetch) — OAuth must leave the app.
            <ButtonLink
              href="/api/hubspot/oauth/start"
              variant="primary"
              className="w-full sm:w-auto"
            >
              Connect HubSpot
            </ButtonLink>
          )}
        </div>
      </div>
    </Card>
  );
}

// ── Sequence setup (per-connection send config) ───────────────────────────────

/**
 * The one manual step send needs after connecting: paste the HubSpot sequence id.
 * HubSpot has no create/list-sequence API, so the number can't be auto-discovered
 * (the sending inbox + user id DO auto-capture at connect). It's written onto the
 * active connection — each portal sends through its OWN sequence. Shows only when
 * HubSpot is connected; a saved id reads as done, so a returning user sees it's set.
 */
function SequenceSetupCard({ initialSequenceId }: { initialSequenceId: string | null }) {
  const [saved, setSaved] = useState<string | null>(initialSequenceId);
  const [value, setValue] = useState(initialSequenceId ?? "");
  const [status, setStatus] = useState<SubmitState>({ kind: "idle" });

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = value.trim();
    // Same rule the route enforces — catch it here for a friendlier message.
    if (!/^\d{1,18}$/.test(trimmed)) {
      setStatus({
        kind: "error",
        message: "Just the number in the URL after /sequence/ (digits only).",
      });
      return;
    }
    setStatus({ kind: "submitting" });
    try {
      const res = await fetch("/api/hubspot/send-config", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sequenceId: trimmed }),
        // Don't silently FOLLOW the session gate's redirect to /login — a followed
        // 307 lands on a 200 HTML page that would masquerade as a saved config.
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
        error?: string;
      } | null;

      // Success requires a real `{ ok: true }` from our route — never just a 200.
      if (!res.ok || body?.ok !== true) {
        setStatus({
          kind: "error",
          message: body?.error ?? "Couldn't save your sequence ID. Please try again.",
        });
        return;
      }

      setSaved(trimmed);
      setStatus({ kind: "ok", tool: trimmed });
    } catch {
      setStatus({
        kind: "error",
        message: "Couldn't reach the server. Please try again.",
      });
    }
  }

  return (
    <Card variant="outlined" padding="lg">
      <form onSubmit={onSubmit} className="flex flex-col gap-5">
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-3">
            <h3 className="font-display text-h5 font-book text-ink">
              Your sending sequence
            </h3>
            <Badge tone={saved ? "success" : "neutral"} size="sm">
              {saved ? "Set" : "Needs setup"}
            </Badge>
          </div>
          <p className="max-w-lg font-sans text-base text-ink-body">
            After you set up your GTM Maestro sequence in HubSpot, paste its ID here.
            It&apos;s the number in the sequence&apos;s URL right after{" "}
            <span className="font-medium">/sequence/</span>. This is the one setting
            we can&apos;t grab automatically.
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor="sequenceId" className="font-sans text-sm font-medium text-ink-strong">
            Sequence ID
          </label>
          <Input
            id="sequenceId"
            name="sequenceId"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="e.g. 712515259"
            inputMode="numeric"
            maxLength={18}
            autoComplete="off"
          />
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <Button type="submit" disabled={status.kind === "submitting"}>
            {status.kind === "submitting" ? "Saving…" : saved ? "Update" : "Save sequence ID"}
          </Button>
          {status.kind === "ok" ? (
            <p role="status" className="font-sans text-base text-success-ink">
              Saved. Sends will enroll into sequence{" "}
              <span className="font-medium">{status.tool}</span>.
            </p>
          ) : null}
          {status.kind === "error" ? (
            <p role="alert" className="font-sans text-base text-danger">
              {status.message}
            </p>
          ) : null}
        </div>
      </form>
    </Card>
  );
}

// ── Engine keys (BYOK) ─────────────────────────────────────────────────────────

/** The two paste-a-key engine credentials (spec § Stack). A key reads "set" when
 *  a real key is stored OR the env fallback is present (the keyless demo). */
export interface EngineKeyStatus {
  anthropic: boolean;
  pdl: boolean;
}

type KeyProviderId = "anthropic" | "pdl";

interface EngineKeyMeta {
  id: KeyProviderId;
  name: string;
  /** What this key powers, in one plain line. */
  blurb: string;
  /** Where to get the key — the inline RevOps step (matches the setup guide). */
  where: string;
  /** A real, clickable link to the provider's key page. */
  href: string;
  /** Placeholder that hints the real key shape without leaking one. */
  placeholder: string;
}

const ENGINE_KEYS: EngineKeyMeta[] = [
  {
    id: "anthropic",
    name: "Anthropic (Claude)",
    blurb: "Researches each practice and writes the brief.",
    where: "Anthropic Console → API keys → Create key.",
    href: "https://console.anthropic.com/settings/keys",
    placeholder: "sk-ant-…",
  },
  {
    id: "pdl",
    name: "People Data Labs",
    blurb: "Finds the decision-maker's verified email + LinkedIn.",
    where: "People Data Labs dashboard → API Keys.",
    href: "https://dashboard.peopledatalabs.com/api-keys",
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
 * or env); a fresh save flips it to "Set" without a reload.
 */
function EngineKeyCard({
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
  return (
    <Card variant="outlined" padding="lg">
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-3">
            <h3 className="font-display text-h5 font-book text-ink">{meta.name}</h3>
            <Badge tone={set ? "success" : "neutral"} size="sm">
              {set ? "Set" : "Not yet"}
            </Badge>
          </div>
          <p className="max-w-md font-sans text-base text-ink-body">{meta.blurb}</p>
        </div>

        <div className="flex flex-col gap-2">
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
        </div>
      </form>
    </Card>
  );
}

// ── Request-an-integration form ────────────────────────────────────────────────

type SubmitState =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "ok"; tool: string }
  | { kind: "error"; message: string };

function RequestIntegrationCard() {
  const [tool, setTool] = useState("");
  const [note, setNote] = useState("");
  const [status, setStatus] = useState<SubmitState>({ kind: "idle" });

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = tool.trim();
    if (trimmed.length === 0) {
      setStatus({ kind: "error", message: "Tell me which tool to add." });
      return;
    }
    setStatus({ kind: "submitting" });
    try {
      const res = await fetch("/api/integration-requests", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tool: trimmed, note: note.trim() }),
        // Don't silently FOLLOW the session gate's redirect to /login — a
        // followed 307 lands on a 200 HTML page that would masquerade as a saved
        // request. `manual` surfaces the redirect as an opaque response instead.
        redirect: "manual",
      });

      // The auth gate bounced us to /login (session expired / not signed in).
      if (res.type === "opaqueredirect" || res.status === 0) {
        setStatus({
          kind: "error",
          message: "Your session expired. Please refresh the page and try again.",
        });
        return;
      }

      const body = (await res.json().catch(() => null)) as {
        ok?: boolean;
        error?: string;
      } | null;

      // Success requires a real `{ ok: true }` from our route — never just a 200.
      if (!res.ok || body?.ok !== true) {
        setStatus({
          kind: "error",
          message: body?.error ?? "Couldn't save your request. Please try again.",
        });
        return;
      }

      setStatus({ kind: "ok", tool: trimmed });
      setTool("");
      setNote("");
    } catch {
      setStatus({
        kind: "error",
        message: "Couldn't reach the server. Please try again.",
      });
    }
  }

  return (
    <Card variant="outlined" padding="lg">
      <form onSubmit={onSubmit} className="flex flex-col gap-5">
        <div className="flex flex-col gap-1.5">
          <h3 className="font-display text-h5 font-book text-ink">
            Request an integration
          </h3>
          <p className="max-w-lg font-sans text-base text-ink-body">
            Salesforce, Outreach, Clay, a marketing tool. Tell me what your team
            runs and I&apos;ll wire it in next. Every request is logged.
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor="tool" className="font-sans text-sm font-medium text-ink-strong">
            Which tool?
          </label>
          <Input
            id="tool"
            name="tool"
            value={tool}
            onChange={(e) => setTool(e.target.value)}
            placeholder="e.g. Salesforce"
            maxLength={120}
            autoComplete="off"
          />
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor="note" className="font-sans text-sm font-medium text-ink-strong">
            What would you use it for?{" "}
            <span className="text-ink-faint">(high-level tl;dr is fine)</span>
          </label>
          <Textarea
            id="note"
            name="note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="How your team uses it, or why it matters."
            maxLength={1000}
          />
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <Button type="submit" disabled={status.kind === "submitting"}>
            {status.kind === "submitting" ? "Sending…" : "Request integration"}
          </Button>
          {status.kind === "ok" ? (
            <p role="status" className="font-sans text-base text-success-ink">
              Thanks. I&apos;ve logged your request for{" "}
              <span className="font-medium">{status.tool}</span>.
            </p>
          ) : null}
          {status.kind === "error" ? (
            <p role="alert" className="font-sans text-base text-danger">
              {status.message}
            </p>
          ) : null}
        </div>
      </form>
    </Card>
  );
}

// ── The page ────────────────────────────────────────────────────────────────

export interface IntegrationsViewProps {
  hubspot: HubSpotStatus;
  /** Which engine keys are present. Defaults to none so the styleguide preview renders. */
  engineKeys?: EngineKeyStatus;
  banner?: ConnectBanner | null;
  /** The RevOps owner the Send handoff routes to — dynamic (D14), never hardcoded.
   *  Defaults so the styleguide preview renders without wiring. */
  owner?: RevOpsOwner;
  /** Real hot-lead count for the value opener; 0 degrades the copy (no fake number). */
  leadCount?: number;
  /** The first live brief to open from the opener; null → link to the feed. */
  firstBriefHref?: string | null;
}

export function IntegrationsView({
  hubspot,
  engineKeys = { anthropic: false, pdl: false },
  banner,
  leadCount = 0,
  firstBriefHref = null,
}: IntegrationsViewProps) {
  return (
    <div
      className="flex flex-1 flex-col"
      style={{ backgroundImage: gradients.healthHero }}
    >
      <TopNav tone="dark" />
      <main className="flex flex-1 flex-col">
        <PageContainer className="flex flex-col gap-8 py-8">
          {banner ? <ConnectResultBanner banner={banner} /> : null}

          <ValueOpener leadCount={leadCount} firstBriefHref={firstBriefHref} />

          <SectionHeader
            tone="dark"
            title="Integrations"
            description="Connect the tools your team already runs. Leads the engine surfaces get pushed, tagged, and tracked where you work."
          />

          <section className="flex flex-col gap-4">
            <h2 className="font-sans text-xl font-medium uppercase tracking-eyebrow text-white/90">
              CRM
            </h2>
            <HubSpotCard status={hubspot} />
            {hubspot.state === "connected" ? (
              <SequenceSetupCard initialSequenceId={hubspot.sequenceId} />
            ) : null}
          </section>

          <section className="flex flex-col gap-4">
            <h2 className="font-sans text-xl font-medium uppercase tracking-eyebrow text-white/90">
              Engine keys
            </h2>
            <p className="max-w-2xl font-sans text-base text-white/80">
              These run the tool on your own account. Paste each one once. HubSpot above is the
              only OAuth connect. Keys are encrypted and never shown again.
            </p>
            {ENGINE_KEYS.map((k) => (
              <EngineKeyCard key={k.id} meta={k} initiallySet={engineKeys[k.id]} />
            ))}
          </section>

          <section className="flex flex-col gap-4">
            <h2 className="font-sans text-xl font-medium uppercase tracking-eyebrow text-white/90">
              Don&apos;t see your stack?
            </h2>
            <RequestIntegrationCard />
          </section>
        </PageContainer>
      </main>
    </div>
  );
}
