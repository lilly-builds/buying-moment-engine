/**
 * Signed-capability for the active-workspace cookie.
 *
 * The `active_workspace` cookie names which tenant workspace a request acts as.
 * On its own that value is forgeable: anyone could set it to another tenant's
 * slug and read or (via /api/workspace/update) overwrite that workspace. So the
 * cookie is not a bare slug, it is `slug.hmac`, signed with the server secret.
 * Only the server can mint a valid signature (at the end of onboarding, for the
 * workspace the visitor just created), so a visitor can only ever hold a valid
 * cookie for their OWN workspace and cannot forge one for someone else's slug.
 *
 * Uses Web Crypto (`crypto.subtle`) so the SAME code verifies in BOTH the Node
 * runtime (getActiveWorkspace, the route handlers) and the Edge runtime (the
 * proxy gate). HMAC-SHA256, hex-encoded, constant-time compared.
 */

const SECRET_ENV = "TOKEN_ENCRYPTION_KEY";
const encoder = new TextEncoder();

async function hmacHex(message: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Constant-time string compare (same length hex strings). */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Mint the signed cookie value for a slug. If the server secret is absent (e.g. a
 * keyless clone), returns the bare slug: `verifyWorkspaceCookie` will then reject
 * it, so the flow fails CLOSED rather than silently accepting unsigned cookies.
 */
export async function signWorkspaceCookie(slug: string): Promise<string> {
  const secret = process.env[SECRET_ENV];
  if (!secret) return slug;
  return `${slug}.${await hmacHex(slug, secret)}`;
}

/**
 * Verify a signed cookie value and return the slug it authorizes, or null if the
 * value is missing, malformed, unsigned, tampered, or the secret is absent.
 */
export async function verifyWorkspaceCookie(
  value: string | null | undefined,
): Promise<string | null> {
  if (!value) return null;
  const secret = process.env[SECRET_ENV];
  if (!secret) return null;

  const lastDot = value.lastIndexOf(".");
  if (lastDot <= 0 || lastDot === value.length - 1) return null;
  const slug = value.slice(0, lastDot);
  const mac = value.slice(lastDot + 1);

  const expected = await hmacHex(slug, secret);
  return timingSafeEqual(mac, expected) ? slug : null;
}
