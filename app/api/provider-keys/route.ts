import { NextResponse, type NextRequest } from "next/server";
import { guardMutation } from "@/src/lib/auth-guard";
import { getDb } from "@/db/client";
import { storeProviderCredential } from "@/db/integrations";
import { readEncryptionKey } from "@/src/crm/config";
import { encrypt } from "@/src/crm/token-crypto";
import {
  isKeyProvider,
  providerLabel,
  validateProviderKey,
  type KeyProvider,
} from "@/src/keys/provider-keys";

// Encrypts + writes to Postgres (node:crypto + pg) — pin the Node runtime, like
// the other mutation routes.
export const runtime = "nodejs";

/**
 * Save a BYOK engine key (U17 · spec § Stack). Session-gated (R18): only a
 * logged-in, allowlisted user may paste a key. The pasted key is validated for
 * format, ENCRYPTED at rest (AES-256-GCM via the same `token-crypto` the HubSpot
 * tokens use), and upserted per provider.
 *
 * The plaintext key is NEVER echoed back: the response carries only
 * `{ ok, provider, present }`. Nothing in this route logs the key, and the stored
 * ciphertext is never returned. `NEXT_PUBLIC_*` is browser-visible — this key is
 * server-only, encrypted, and reachable only through the RLS-locked owner
 * connection.
 */

const MAX_KEY_LENGTH = 512;

interface ParsedBody {
  provider: KeyProvider;
  key: string;
}

function parseBody(input: unknown): ParsedBody | null {
  if (typeof input !== "object" || input === null) return null;
  const b = input as Record<string, unknown>;
  if (!isKeyProvider(b.provider)) return null;
  if (typeof b.key !== "string" || b.key.length > MAX_KEY_LENGTH) return null;
  return { provider: b.provider, key: b.key };
}

export async function POST(request: NextRequest) {
  const auth = await guardMutation();
  if (!auth.ok) return NextResponse.json(auth.body, { status: auth.status });

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const body = parseBody(raw);
  if (!body) {
    return NextResponse.json(
      { error: "Tell us which key to set (anthropic or pdl) and paste a value." },
      { status: 400 },
    );
  }

  const check = validateProviderKey(body.provider, body.key);
  if (!check.ok) {
    return NextResponse.json({ error: check.reason }, { status: 400 });
  }

  // Encryption key must be configured to store a secret. A missing key is an
  // environment problem, not the user's — answer 503 without leaking anything.
  let encryptionKey: Buffer;
  try {
    encryptionKey = readEncryptionKey();
  } catch {
    return NextResponse.json(
      {
        error:
          "This environment can't store keys yet (encryption isn't configured). Please try again once setup is complete.",
      },
      { status: 503 },
    );
  }

  try {
    // Encrypt the TRIMMED key — a copy-paste newline is not part of the secret.
    const secretEnc = encrypt(body.key.trim(), encryptionKey);
    await storeProviderCredential(getDb(), {
      provider: body.provider,
      secretEnc,
    });
    // Presence only — never the key, never the ciphertext.
    return NextResponse.json({
      ok: true,
      provider: body.provider,
      present: true,
    });
  } catch {
    // No DATABASE_URL / DB unreachable -> honest failure, never a silent success.
    return NextResponse.json(
      {
        error: `Couldn't save your ${providerLabel(body.provider)} key. Please try again.`,
      },
      { status: 503 },
    );
  }
}
