import { timingSafeEqual } from "node:crypto";

/**
 * Constant-time shared-secret check for the Clay enrich-callback (R18: that
 * route is shared-secret gated, not session gated). Fails closed if either the
 * provided or the expected secret is missing. Node runtime only.
 */
export function verifySharedSecret(
  provided: string | null | undefined,
  expected: string | null | undefined,
): boolean {
  if (!provided || !expected) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
