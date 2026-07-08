import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { themeVars } from "@/design/tokens";

/**
 * U2 / R15 — the design tokens are only real if Tailwind actually resolves them.
 *
 * This repo runs Tailwind v4, which reads its theme from CSS (`@theme`), not from
 * a `tailwind.config.ts`. That means the token values live in two places:
 * `design/tokens.ts` (for TS consumers — chart series, inline SVG) and
 * `app/globals.css` (for every Tailwind class). These tests fail if the two ever
 * disagree, in EITHER direction.
 *
 * Why this test exists: Wave 1 shipped a `tokens.draft.ts` that nothing imported,
 * so no class resolved to a brand color and nobody noticed. A token nothing
 * renders is not a token. This is the guard.
 */

const CSS = readFileSync(
  path.resolve(__dirname, "../../app/globals.css"),
  "utf8",
);

/** Only the static `@theme { … }` block. The `@theme inline { … }` block holds
 *  font families that reference next/font's injected vars — those have no hex
 *  counterpart in tokens.ts and are excluded on purpose. */
function staticThemeBlock(css: string): string {
  const start = css.indexOf("@theme {");
  expect(start, "app/globals.css must declare a static `@theme {` block").toBeGreaterThan(-1);
  let depth = 0;
  for (let i = start; i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}") {
      depth--;
      if (depth === 0) return css.slice(start, i + 1);
    }
  }
  throw new Error("Unbalanced braces in the @theme block of app/globals.css");
}

const THEME = staticThemeBlock(CSS);

/** Parse `--name: value;` pairs out of the theme block. */
function declaredVars(block: string): Map<string, string> {
  const found = new Map<string, string>();
  const re = /(--[a-z0-9-]+)\s*:\s*([^;]+);/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block)) !== null) {
    found.set(m[1], m[2].trim().replace(/\s+/g, " "));
  }
  return found;
}

const DECLARED = declaredVars(THEME);

describe("design tokens ↔ Tailwind @theme parity", () => {
  it("declares every token from design/tokens.ts in app/globals.css", () => {
    const missing = Object.keys(themeVars).filter((v) => !DECLARED.has(v));
    expect(missing, `tokens.ts declares these, globals.css does not: ${missing.join(", ")}`).toEqual([]);
  });

  it("declares no design token in app/globals.css that tokens.ts does not define", () => {
    const orphans = [...DECLARED.keys()].filter(
      (v) => !(v in themeVars),
    );
    expect(orphans, `globals.css declares these, tokens.ts does not: ${orphans.join(", ")}`).toEqual([]);
  });

  it("agrees on every token value", () => {
    const mismatches: string[] = [];
    for (const [name, value] of Object.entries(themeVars)) {
      const css = DECLARED.get(name);
      // Normalize whitespace so multi-value shadows compare cleanly.
      const want = value.trim().replace(/\s+/g, " ");
      if (css !== want) mismatches.push(`${name}: tokens.ts=${want!} css=${css}`);
    }
    expect(mismatches).toEqual([]);
  });
});

describe("the brand direction resolved in U2", () => {
  it("keeps purple as the action color and blue as the healthcare surface", () => {
    // Verified live 2026-07-08: eliseai.com/healthai paints a blue hero and still
    // renders its primary CTA in #7638fa. If either of these values changes, the
    // brand call in tokens.ts changed with it — and Lilly re-signs off.
    expect(themeVars["--color-brand"]).toBe("#7638fa");
    expect(themeVars["--color-health"]).toBe("#146ef4");
  });

  it("uses the 450 'book' display weight, not 400 or 600", () => {
    // The single most distinctive thing about EliseAI's type. VERIFIED-LIVE on
    // both the multifamily and healthcare heroes.
    expect(themeVars["--font-weight-book"]).toBe("450");
    expect(themeVars["--text-display--font-weight"]).toBe("450");
  });

  it("keeps the secondary-button border at its RESTING value", () => {
    // tokens.draft.ts had the hover border (#c1bafe) as the resting border.
    expect(themeVars["--color-line-outline"]).toBe("#dfdbff");
    expect(themeVars["--color-line-outline-hover"]).toBe("#c1bafe");
  });
});
