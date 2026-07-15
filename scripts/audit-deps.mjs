#!/usr/bin/env node
/**
 * Dependency vulnerability audit — fails on HIGH or CRITICAL advisories, reports
 * the rest. This is a drop-in replacement for `pnpm audit --audit-level=high`,
 * which npm broke by retiring the legacy `/-/npm/v1/security/audits` endpoint
 * (it now returns HTTP 410). We query npm's CURRENT bulk advisory endpoint — the
 * same data source `npm audit` uses — against the actually-installed pnpm tree,
 * so the check keeps its exact policy and coverage, just with a working backend.
 *
 * Exit 0 = no high/critical. Exit 1 = at least one high/critical (fails CI).
 * A network/endpoint error also exits 1 — a security gate must fail closed, never
 * pass silently when it couldn't actually check.
 */

import { execFileSync } from "node:child_process";

const BULK_ENDPOINT =
  "https://registry.npmjs.org/-/npm/v1/security/advisories/bulk";
const BLOCKING = new Set(["high", "critical"]);

/** Flatten `pnpm ls --depth Infinity --json` into name -> Set(installed versions). */
function collectInstalled() {
  // Fixed argument list, no shell — nothing here is user-controlled.
  const raw = execFileSync("pnpm", ["ls", "--depth", "Infinity", "--json"], {
    encoding: "utf8",
    maxBuffer: 128 * 1024 * 1024,
  });
  const projects = JSON.parse(raw);
  const map = new Map();
  const add = (name, version) => {
    if (!version) return;
    if (!map.has(name)) map.set(name, new Set());
    map.get(name).add(version);
  };
  const walk = (deps) => {
    if (!deps) return;
    for (const [name, info] of Object.entries(deps)) {
      if (!info || typeof info !== "object") continue;
      add(name, info.version);
      walk(info.dependencies);
    }
  };
  for (const proj of projects) {
    walk(proj.dependencies);
    walk(proj.devDependencies);
    walk(proj.optionalDependencies);
  }
  return map;
}

async function fetchAdvisories(installed) {
  const body = {};
  for (const [name, versions] of installed) body[name] = [...versions];
  const res = await fetch(BULK_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "npm-command": "audit",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`bulk advisory endpoint responded ${res.status}`);
  }
  return res.json();
}

async function main() {
  const installed = collectInstalled();
  console.log(`Auditing ${installed.size} unique packages...`);

  const advisories = await fetchAdvisories(installed);
  const blocking = [];
  const informational = [];

  for (const [name, list] of Object.entries(advisories)) {
    for (const a of list) {
      const row = {
        name,
        severity: a.severity,
        title: a.title,
        range: a.vulnerable_versions,
        url: a.url,
      };
      (BLOCKING.has(a.severity) ? blocking : informational).push(row);
    }
  }

  if (informational.length) {
    console.log(`\n${informational.length} moderate/low advisory(ies) (not blocking):`);
    for (const r of informational) {
      console.log(`  - [${r.severity}] ${r.name} ${r.range} — ${r.title}`);
    }
  }

  if (blocking.length) {
    console.error(`\n✗ ${blocking.length} HIGH/CRITICAL advisory(ies):`);
    for (const r of blocking) {
      console.error(`  - [${r.severity}] ${r.name} ${r.range} — ${r.title}`);
      console.error(`    ${r.url}`);
    }
    console.error("\nFailing: resolve or override these before merging.");
    process.exit(1);
  }

  console.log("\n✓ No high or critical advisories.");
  process.exit(0);
}

main().catch((err) => {
  console.error(`✗ Dependency audit could not complete: ${err.message}`);
  console.error("Failing closed — a security gate must not pass unchecked.");
  process.exit(1);
});
