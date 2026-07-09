import type { SignalKind } from "@/design/tokens";
import type { DetectorKind } from "@/src/ingest/validate";
import { PACK_VERTICALS, type PackVertical } from "@/src/packs";

/**
 * The boundary between the DATABASE's vocabulary and the DESIGN KIT's (U8/U9).
 *
 * Postgres enums are snake_case (`staffing_spike`, `womens_health`); the design kit
 * keys its gradients and filter values in kebab-case (`staffing-spike`,
 * `womens-health`). Something has to translate, and it must live HERE, in `src/`:
 * `design/` may never import from `db/`, or the kit stops being renderable in
 * isolation on `/styleguide` and the token-parity test loses its meaning.
 *
 * This module is deliberately pure and total. No I/O, no `as` casts, no index
 * signature that silently returns `undefined`.
 *
 * ─── The `regulation` problem, and why this returns `null` ────────────────────
 *
 * `DetectorKind` has FOUR members. `signalGradients` has THREE. `regulation` is
 * spec D3's research-gated signal: documented, deliberately NOT built (there is no
 * `src/detectors/regulation*.ts`), and therefore it has no colour in the design
 * vocabulary.
 *
 * A `Record<DetectorKind, SignalKind>` lookup on `regulation` would return
 * `undefined`, `SignalPill` would set `backgroundImage: undefined`, and the pill
 * would render as white text on a white card — invisible, on the one element whose
 * entire job is to say why an AE should call this practice today.
 *
 * So the map is explicit and exhaustive, `regulation` maps to `null`, and callers
 * must handle the null. When the regulation detector is eventually built, add its
 * gradient to `signalGradients` and change one line here — the compiler will find
 * every call site.
 */

/** DB kind -> the design kit's kind. `null` means "no pill exists for this kind". */
const KIND_TO_PILL: Record<DetectorKind, SignalKind | null> = {
  staffing_spike: "staffing-spike",
  phone_complaints: "phone-complaints",
  growth_events: "growth-events",
  // See the file header. Not an oversight — an unbuilt signal with no colour.
  regulation: null,
};

/** The design kit's kind for a detector kind, or `null` if it has no pill. */
export function toSignalKind(kind: DetectorKind): SignalKind | null {
  return KIND_TO_PILL[kind];
}

/**
 * Only the kinds that can actually be drawn, in the caller's order.
 *
 * Use this wherever a list of pills is rendered, so an unbuilt kind is dropped at
 * one place rather than in every `.map()`.
 */
export function toSignalKinds(kinds: readonly DetectorKind[]): SignalKind[] {
  return kinds
    .map(toSignalKind)
    .filter((kind): kind is SignalKind => kind !== null);
}

/** Kebab-case vertical, as the feed's filter and the design kit spell it. */
export type VerticalSlug =
  | "dermatology"
  | "womens-health"
  | "ophthalmology"
  | "orthopedics";

const VERTICAL_TO_SLUG: Record<PackVertical, VerticalSlug> = {
  dermatology: "dermatology",
  womens_health: "womens-health",
  ophthalmology: "ophthalmology",
  orthopedics: "orthopedics",
};

export function toVerticalSlug(vertical: PackVertical): VerticalSlug {
  return VERTICAL_TO_SLUG[vertical];
}

/** Human label for a vertical. The filter's visible text. */
const VERTICAL_LABELS: Record<VerticalSlug, string> = {
  dermatology: "Dermatology",
  "womens-health": "Women's Health",
  ophthalmology: "Ophthalmology",
  orthopedics: "Orthopedics",
};

export type FeedFilterValue = "all" | VerticalSlug;

/**
 * The feed's vertical filter options, derived from `PACK_VERTICALS` rather than
 * hand-listed. Authoring a fifth pack adds a fifth filter automatically; hand-listing
 * them is how a new vertical ships invisible.
 */
export const VERTICAL_FILTERS: ReadonlyArray<{
  value: FeedFilterValue;
  label: string;
}> = [
  { value: "all", label: "All" },
  ...PACK_VERTICALS.map((vertical) => {
    const slug = toVerticalSlug(vertical);
    return { value: slug, label: VERTICAL_LABELS[slug] };
  }),
];
