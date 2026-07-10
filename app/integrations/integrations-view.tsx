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
import { DEFAULT_TARGET, type RevOpsOwner } from "@/src/target/config";
import { ConnectionRow } from "@/design/components/onboarding/connection-row";
import {
  CONNECTIONS,
  deriveConnectionStatus,
  deriveGoLive,
  type ConnectionId,
} from "@/src/connect/connections";
import { ValueOpener } from "./value-opener";
import { SequenceSetupHelp } from "./sequence-setup-help";
import { EngineKeyCard, ENGINE_KEYS } from "./engine-key-card";

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
    "HubSpot isn't set up on this environment yet. The connection keys are still to come.",
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

// ── The HubSpot connect action (step 1 inside the HubSpot ConnectionRow) ──────

/** Flat connect content — no Card of its own, since the ConnectionRow is the card. */
function HubSpotConnectAction({ status }: { status: HubSpotStatus }) {
  const connected = status.state === "connected";
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <span className="font-sans text-sm font-medium uppercase tracking-eyebrow text-ink-faint">
          Step 1
        </span>
        <h4 className="font-display text-lg font-book text-ink">Connect your HubSpot</h4>
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <span className="flex size-12 shrink-0 items-center justify-center rounded-panel bg-surface-subtle">
          <HubSpotMark className="size-7" />
        </span>
        {/* A real top-level navigation (not fetch) — OAuth must leave the app. */}
        <ButtonLink
          href="/api/hubspot/oauth/start"
          variant={connected ? "secondary" : "primary"}
        >
          {connected ? "Reconnect" : "Connect HubSpot"}
        </ButtonLink>
      </div>
    </div>
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

// ── Connections checklist (the RevOps onboarding) ────────────────────────────

const CONNECTION_META = Object.fromEntries(
  CONNECTIONS.map((c) => [c.id, c]),
) as Record<ConnectionId, (typeof CONNECTIONS)[number]>;

/** The honest go-live line — keyed on the real send-ready signal (connected AND a
 *  sequence id), so "You're live" means the tool can genuinely send. */
function GoLiveSummary({
  hubspot,
  owner,
}: {
  hubspot: HubSpotStatus;
  owner: RevOpsOwner;
}) {
  const go = deriveGoLive(hubspot);
  const message = go.live
    ? "You're live. Sending and CRM tracking are on."
    : go.sequencePending
      ? "Almost there. Finish setting up your sequence to go live."
      : `One step left: ${owner.firstName} connects HubSpot to go live.`;
  return (
    <div
      className={
        go.live
          ? "flex items-center gap-3 rounded-panel bg-success-surface px-4 py-3"
          : "flex items-center gap-3 rounded-panel bg-white/10 px-4 py-3"
      }
    >
      <span
        aria-hidden
        className={
          go.live
            ? "size-2 shrink-0 rounded-pill bg-success-ink"
            : "size-2 shrink-0 rounded-pill border border-white/50"
        }
      />
      <p
        className={
          go.live
            ? "font-sans text-base text-success-ink"
            : "font-sans text-base text-white/90"
        }
      >
        {message}
      </p>
    </div>
  );
}

/**
 * The Connections checklist: HubSpot + the two BYOK keys as StepCard-style rows
 * with status pills (design §C). The HubSpot row is a 3-step flow — connect → set
 * up your sequence → sequence saved (the shipped SequenceSetupCard) — wrapping the
 * PR #21 pieces, not rebuilding them.
 */
function ConnectionsChecklist({
  hubspot,
  engineKeys,
  owner,
}: {
  hubspot: HubSpotStatus;
  engineKeys: EngineKeyStatus;
  owner: RevOpsOwner;
}) {
  const ctx = { hubspot, engineKeys };
  const hub = CONNECTION_META.hubspot;
  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h2 className="font-sans text-xl font-medium uppercase tracking-eyebrow text-white/90">
          Connections
        </h2>
        <p className="max-w-2xl font-sans text-base text-white/80">
          One OAuth connect turns sending on; two keys run the engine on your own
          account. Keys are encrypted and never shown again.
        </p>
      </div>

      <GoLiveSummary hubspot={hubspot} owner={owner} />

      {/* HubSpot — connect → set up your sequence → sequence saved */}
      <ConnectionRow
        icon={hub.icon}
        line={hub.line}
        detail={hub.detail}
        chip={hub.chip}
        status={deriveConnectionStatus("hubspot", ctx)}
        required={hub.required}
        dataTour="connect-hubspot"
      >
        <HubSpotConnectAction status={hubspot} />
        {hubspot.state === "connected" ? (
          <>
            <SequenceSetupHelp />
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <span className="font-sans text-sm font-medium uppercase tracking-eyebrow text-ink-faint">
                  Step 3
                </span>
                <h4 className="font-display text-lg font-book text-ink">
                  Add your sequence ID
                </h4>
              </div>
              <SequenceSetupCard initialSequenceId={hubspot.sequenceId} />
            </div>
          </>
        ) : null}
      </ConnectionRow>

      {/* The two BYOK engine keys */}
      {(["anthropic", "pdl"] as const).map((id) => {
        const meta = CONNECTION_META[id];
        const keyMeta = ENGINE_KEYS.find((k) => k.id === id);
        if (!keyMeta) return null;
        return (
          <ConnectionRow
            key={id}
            icon={meta.icon}
            line={meta.line}
            detail={meta.detail}
            chip={meta.chip}
            status={deriveConnectionStatus(id, ctx)}
            dataTour={`key-${id}`}
          >
            <EngineKeyCard meta={keyMeta} initiallySet={engineKeys[id]} />
          </ConnectionRow>
        );
      })}
    </section>
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
  owner = DEFAULT_TARGET.revOpsOwner,
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

          <ConnectionsChecklist
            hubspot={hubspot}
            engineKeys={engineKeys}
            owner={owner}
          />

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
