import { NextResponse, type NextRequest } from "next/server";
import { guardMutation } from "@/src/lib/auth-guard";
import { getDb } from "@/db/client";
import { recordIntegrationRequest } from "@/db/integrations";

// Writes to Postgres — pin the Node runtime (matches the other mutation routes).
export const runtime = "nodejs";

/**
 * "Request an integration" capture (U17). Session-gated (R18): only a logged-in,
 * allowlisted user can file a request, and the request is stamped with THAT
 * email server-side (never trusted from the body). Persists to
 * `integration_requests` so the ask is a tracked demand signal (D14), not a
 * fire-and-forget mailto — that's what makes the input field wired end-to-end.
 */

const CATEGORIES = new Set(["crm", "marketing", "sales", "other"]);
const MAX_TOOL = 120;
const MAX_NOTE = 1000;

interface ParsedRequest {
  tool: string;
  category: string;
  note: string | null;
}

function parseBody(input: unknown): ParsedRequest | null {
  if (typeof input !== "object" || input === null) return null;
  const b = input as Record<string, unknown>;

  const tool = typeof b.tool === "string" ? b.tool.trim() : "";
  if (tool.length === 0 || tool.length > MAX_TOOL) return null;

  const rawCategory =
    typeof b.category === "string" ? b.category.trim().toLowerCase() : "other";
  const category = CATEGORIES.has(rawCategory) ? rawCategory : "other";

  const rawNote = typeof b.note === "string" ? b.note.trim() : "";
  if (rawNote.length > MAX_NOTE) return null;

  return { tool, category, note: rawNote.length > 0 ? rawNote : null };
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
      { error: "Tell us which tool to add (up to 120 characters)." },
      { status: 400 },
    );
  }

  try {
    const { id } = await recordIntegrationRequest(getDb(), {
      tool: body.tool,
      category: body.category,
      note: body.note,
      requestedBy: auth.email,
    });
    return NextResponse.json({ ok: true, id });
  } catch {
    // No DATABASE_URL / DB unreachable -> honest failure, never a silent success.
    return NextResponse.json(
      { error: "Couldn't save your request. Please try again." },
      { status: 503 },
    );
  }
}
