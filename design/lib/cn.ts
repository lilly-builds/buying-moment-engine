export type ClassValue = string | false | null | undefined;

/**
 * Join class names, dropping falsy values.
 *
 * Deliberately NOT `tailwind-merge`: the kit composes its own classes and never
 * needs conflict resolution, so this stays a zero-dependency two-liner. If a
 * consumer ever needs to override a kit class via `className`, put the consumer's
 * `className` last — it wins on specificity ties by source order.
 */
export function cn(...values: ClassValue[]): string {
  return values.filter(Boolean).join(" ");
}
