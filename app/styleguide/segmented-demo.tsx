"use client";

import { useState } from "react";
import { SegmentedControl } from "@/design/components";

/** The four EliseAI healthcare verticals (D6) — exactly what U8's feed filter shows. */
const VERTICALS = [
  { value: "all", label: "All" },
  { value: "dermatology", label: "Dermatology" },
  { value: "womens-health", label: "Women's Health" },
  { value: "ophthalmology", label: "Ophthalmology" },
  { value: "orthopedics", label: "Orthopedics" },
] as const;

type Vertical = (typeof VERTICALS)[number]["value"];

const SCOPES = [
  { value: "aggregate", label: "Aggregate" },
  { value: "per-vertical", label: "Per-vertical" },
] as const;

type Scope = (typeof SCOPES)[number]["value"];

/**
 * The segmented control is the one interactive component with no EliseAI source
 * rule behind it, so the styleguide drives it live — click it, arrow-key it.
 */
export function SegmentedDemo() {
  const [vertical, setVertical] = useState<Vertical>("all");
  const [scope, setScope] = useState<Scope>("aggregate");

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <span className="font-mono text-xs uppercase text-ink-subtle">
          U8 — feed vertical filter (brand accent)
        </span>
        <div className="flex flex-wrap items-center gap-4">
          <SegmentedControl<Vertical>
            label="Filter feed by vertical"
            options={VERTICALS}
            value={vertical}
            onValueChange={setVertical}
          />
          <span className="font-mono text-sm text-ink-muted">value: {vertical}</span>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <span className="font-mono text-xs uppercase text-ink-subtle">
          U12 — scoreboard scope toggle (health accent)
        </span>
        <div className="flex flex-wrap items-center gap-4">
          <SegmentedControl<Scope>
            label="Scoreboard scope"
            options={SCOPES}
            value={scope}
            onValueChange={setScope}
            accent="health"
          />
          <span className="font-mono text-sm text-ink-muted">value: {scope}</span>
        </div>
      </div>
    </div>
  );
}
