import type { WorkspaceConfig } from "@/src/workspace/schema";

/**
 * design/brand.ts — the runtime theming engine (Adapt-It P2).
 *
 * `brandVars(brand)` maps a tenant's brand (four hex colors from their workspace
 * config) to the full CSS-variable OVERRIDE map that re-skins 100% of the surface.
 * It is the one lever: `design/brand-provider.tsx` sets these vars on a wrapper
 * that contains the app, so every component reading a `--color-*` / `--gradient-*`
 * token — buttons, pills, heroes, the StatRing arc, the signal gradients — repaints
 * to the tenant with no per-component change. The globals.css `@theme` block holds
 * the DEFAULT (EliseAI) values; this override is a runtime layer on top, never an
 * edit to that file (which a parity test locks).
 *
 * PURE and SSR-safe: no `window`, no DOM, no side effects. That is what lets the
 * server inject the override in `app/layout.tsx` for a flash-free first paint, and
 * what lets the onboarding live-preview (P3) call `brandVars(partialBrand)` on
 * every keystroke to re-skin a preview instantly.
 *
 * The ramp is derived with a tiny local HSL model (no new dependency): the tenant
 * gives one primary and one accent; we generate the tints, shades, hovers, and
 * gradients from them so the whole system stays in one hue family.
 */

interface Rgb {
  r: number;
  g: number;
  b: number;
}
interface Hsl {
  /** degrees, [0, 360) */
  h: number;
  /** [0, 1] */
  s: number;
  /** [0, 1] */
  l: number;
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function hexToRgb(hex: string): Rgb {
  const h = hex.replace("#", "");
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

function channelHex(n: number): string {
  return Math.max(0, Math.min(255, Math.round(n)))
    .toString(16)
    .padStart(2, "0");
}

function rgbToHex({ r, g, b }: Rgb): string {
  return `#${channelHex(r)}${channelHex(g)}${channelHex(b)}`;
}

function rgbToHsl({ r, g, b }: Rgb): Hsl {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0);
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  return { h: h * 60, s, l };
}

function hslToRgb({ h, s, l }: Hsl): Rgb {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = ((((h % 360) + 360) % 360) / 60);
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;
  if (hp < 1) [r, g] = [c, x];
  else if (hp < 2) [r, g] = [x, c];
  else if (hp < 3) [g, b] = [c, x];
  else if (hp < 4) [g, b] = [x, c];
  else if (hp < 5) [r, b] = [x, c];
  else [r, b] = [c, x];
  const m = l - c / 2;
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
}

function toHsl(hex: string): Hsl {
  return rgbToHsl(hexToRgb(hex));
}

/** A hex from raw H/S/L, clamping S and L into range. */
function hsl(h: number, s: number, l: number): string {
  return rgbToHex(hslToRgb({ h, s: clamp01(s), l: clamp01(l) }));
}

/** A straight RGB mix of two hexes, `t` in [0, 1] (0 = a, 1 = b). */
function mix(a: string, b: string, t: number): string {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  return rgbToHex({
    r: ca.r + (cb.r - ca.r) * t,
    g: ca.g + (cb.g - ca.g) * t,
    b: ca.b + (cb.b - ca.b) * t,
  });
}

/**
 * The full CSS-variable override for a tenant brand. Every key here is a token
 * the component kit actually reads (verified by grepping the `-brand`/`-health`
 * utility usage + the promoted `--gradient-*` tokens), so the re-skin is total.
 *
 * NOTE — this is intentionally NOT applied to the synthetic default workspace
 * (the layout passes `{}` there): the default keeps the hand-tuned EliseAI ramp
 * in globals.css exactly, so nothing visibly changes for it. This derived ramp is
 * for real tenants.
 */
const WHITE = "#ffffff";
const BLACK = "#000000";

export function brandVars(brand: WorkspaceConfig["brand"]): Record<string, string> {
  const primary = brand.primaryColor;
  const accent = brand.accentColor;
  const { h: primaryHue, s: primarySat } = toHsl(primary);

  // Ramps built by mixing toward white (tint) / black (shade), NOT by fixed target
  // lightnesses: a tenant primary can be light or dark, and mixing keeps the ramp
  // monotonic either way — every tint is lighter than the primary, every shade
  // darker. (A fixed-L ramp made a dark primary's "hover" LIGHTER than its rest.)
  const tint = (amount: number) => mix(primary, WHITE, amount);
  const shade = (amount: number) => mix(primary, BLACK, amount);
  const tintAccent = (amount: number) => mix(accent, WHITE, amount);
  const shadeAccent = (amount: number) => mix(accent, BLACK, amount);

  // Brand ramp (the action color). DEFAULT and 600 ARE the primary.
  const brand50 = tint(0.92);
  const brand100 = tint(0.85);
  const brand200 = tint(0.72);
  const brand300 = tint(0.55);
  const brand400 = tint(0.3);
  const brand500 = tint(0.12);
  const brand700 = shade(0.15);
  const brand800 = shade(0.28); // primary :hover — always darker than 600
  const brand900 = shade(0.45);
  const brand950 = shade(0.72);

  // Health / accent ramp — the SURFACE / identity field, re-keyed to the accent.
  const healthLight = tintAccent(0.45);
  const healthPale = tintAccent(0.72);
  const healthSurface = tintAccent(0.86);
  const healthDark = shadeAccent(0.72);
  const healthVivid = shadeAccent(0.08);

  // Dark section surface — a very dark shade of the brand hue (absolute L ~ 0.10,
  // where white text stays readable for any hue).
  const surfaceDark = hsl(primaryHue, Math.min(primarySat, 0.72), 0.1);

  // Gradients — mirror the STRUCTURE of the EliseAI defaults, re-tinted from the
  // tenant's own colors so the hero, the brief panel, the orb, and each signal
  // pill all wear the brand.
  const heroMid = mix(brand.heroFrom, brand.heroTo, 0.45);
  const gradientHero = `linear-gradient(180deg, ${brand.heroFrom} 0%, ${heroMid} 55%, ${brand.heroTo} 100%)`;
  // The calm working surface (P5). Same top stop as the hero (keeps the white nav
  // legible), but it settles between the mid and the pale end instead of fading all
  // the way to `heroTo` — calmer and more contained than the arrival hero.
  const heroCalmEnd = mix(heroMid, brand.heroTo, 0.4);
  const gradientHeroCalm = `linear-gradient(180deg, ${brand.heroFrom} 0%, ${heroMid} 60%, ${heroCalmEnd} 100%)`;
  const gradientBrand = `linear-gradient(94deg, ${tint(0.22)}, ${tintAccent(0.2)} 80%, ${accent})`;
  const gradientOrb = `radial-gradient(circle at 32% 28%, ${brand400}, ${primary} 46%, ${accent} 100%)`;
  const signalStaffing = `linear-gradient(94deg, ${primary} 30%, ${tint(0.2)} 73%)`;
  const signalPhone = `linear-gradient(94deg, ${healthVivid} 30%, ${tintAccent(0.12)} 73%)`;
  const signalGrowth = `linear-gradient(94deg, ${shade(0.22)} 30%, ${mix(primary, accent, 0.5)} 73%)`;

  return {
    // Brand ramp (the action color)
    "--color-brand": primary,
    "--color-brand-50": brand50,
    "--color-brand-100": brand100,
    "--color-brand-200": brand200,
    "--color-brand-300": brand300,
    "--color-brand-400": brand400,
    "--color-brand-500": brand500,
    "--color-brand-600": primary,
    "--color-brand-700": brand700,
    "--color-brand-800": brand800,
    "--color-brand-900": brand900,
    "--color-brand-950": brand950,
    "--color-brand-hover-ink": tint(0.14),
    "--color-eyebrow": tint(0.1),
    // Health / accent ramp (the surface / identity field)
    "--color-health": accent,
    "--color-health-light": healthLight,
    "--color-health-pale": healthPale,
    "--color-health-surface": healthSurface,
    "--color-health-dark": healthDark,
    "--color-health-vivid": healthVivid,
    // Dark section surfaces, re-tinted to the brand hue
    "--color-surface-dark": surfaceDark,
    "--color-ink-purple": surfaceDark,
    // Gradients (the four promoted tokens + the three per-signal identities)
    "--gradient-hero": gradientHero,
    "--gradient-hero-calm": gradientHeroCalm,
    "--gradient-brand": gradientBrand,
    "--gradient-orb": gradientOrb,
    "--gradient-signal-staffing-spike": signalStaffing,
    "--gradient-signal-phone-complaints": signalPhone,
    "--gradient-signal-growth-events": signalGrowth,
  };
}
