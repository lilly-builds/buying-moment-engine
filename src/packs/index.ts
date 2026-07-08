import { dermatologyPack } from "./dermatology";
import { loadPack } from "./loader";
import { ophthalmologyPack } from "./ophthalmology";
import { orthopedicsPack } from "./orthopedics";
import { PACK_VERTICALS, type PackVertical, type VerticalPack } from "./schema";
import { womensHealthPack } from "./womens-health";

/**
 * Packs registry (U7) — the ONE lookup U6 (brief synthesizer) uses to get a
 * validated pack by vertical. Packs are validated on every access rather
 * than trusted as hand-checked data — a malformed pack must never ship
 * silently (mirrors the fail-loud pattern in src/ingest/validate.ts).
 */

const RAW_PACKS: Record<PackVertical, unknown> = {
  dermatology: dermatologyPack,
  womens_health: womensHealthPack,
  ophthalmology: ophthalmologyPack,
  orthopedics: orthopedicsPack,
};

/** Load + validate the pack for one vertical. Throws if malformed — see `loadPack` for a non-throwing variant. */
export function getPack(vertical: PackVertical): VerticalPack {
  const result = loadPack(RAW_PACKS[vertical]);
  if (!result.ok) {
    throw new Error(`pack "${vertical}" failed validation: ${result.reason}`);
  }
  return result.pack;
}

/** All four packs, validated. Useful for a boot-time "load everything" check. */
export function getAllPacks(): Record<PackVertical, VerticalPack> {
  const entries = PACK_VERTICALS.map(
    (vertical) => [vertical, getPack(vertical)] as const,
  );
  return Object.fromEntries(entries) as Record<PackVertical, VerticalPack>;
}

export { PACK_VERTICALS };
export type { PackVertical, VerticalPack };
