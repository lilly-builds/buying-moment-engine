import type {
  BuyerTier,
  DiscoveredContactCandidate,
  SelectedContactClassification,
} from "./types";

const BAD_ROLE = /\b(sales|marketing|student|intern|recruiter|resident|vendor|consultant)\b/i;
const TIER_A = /\b(founder|owner|co[-\s]?owner|managing partner|chief executive|\bceo\b|chief operating|\bcoo\b|president|physician owner|medical director)\b/i;
const TIER_B = /\b(practice administrator|practice manager|operations manager|director of operations|clinic manager|office administrator)\b/i;
const TIER_C = /\b(office manager|revenue cycle|billing manager|administrator|business manager)\b/i;
const TIER_D = /\b(coordinator|executive assistant|patient access|scheduling manager|front office|office coordinator)\b/i;
const TIER_E = /\b(physician|doctor|\bmd\b|d\.o\.|therapist|provider|surgeon|dermatologist|ophthalmologist|optometrist|orthopedic)\b/i;

export function classifyBuyerTier(role: string | null | undefined): BuyerTier {
  if (!role?.trim()) return "none";
  if (BAD_ROLE.test(role)) return "X";
  if (TIER_A.test(role)) return "A";
  if (TIER_B.test(role)) return "B";
  if (TIER_C.test(role)) return "C";
  if (TIER_D.test(role)) return "D";
  if (TIER_E.test(role)) return "E";
  return "none";
}

export function classifySelection(tier: BuyerTier): SelectedContactClassification {
  if (tier === "A" || tier === "B") return "best_buyer";
  if (tier === "C" || tier === "D" || tier === "E") return "reachable_fallback";
  if (tier === "X") return "weak_unrelated";
  return "none";
}

export function isUsableCandidate(candidate: DiscoveredContactCandidate): boolean {
  if (!candidate.name?.trim()) return false;
  return classifyBuyerTier(candidate.role) !== "X";
}

function tierScore(tier: BuyerTier): number {
  return { A: 500, B: 420, C: 340, D: 260, E: 160, none: 80, X: -500 }[tier];
}

function domainMatches(candidate: DiscoveredContactCandidate, domain: string | null): boolean {
  if (!domain || !candidate.companyDomain) return false;
  return candidate.companyDomain.replace(/^www\./, "").toLowerCase() === domain.toLowerCase();
}

export interface RankedContact {
  candidate: DiscoveredContactCandidate;
  tier: BuyerTier;
  classification: SelectedContactClassification;
  score: number;
}

export function rankContactCandidates(
  candidates: readonly DiscoveredContactCandidate[],
  context: { websiteDomain?: string | null; state?: string | null } = {},
): RankedContact[] {
  const websiteDomain = context.websiteDomain?.replace(/^www\./, "") ?? null;
  return candidates
    .map((candidate) => {
      const tier = classifyBuyerTier(candidate.role);
      let score = tierScore(tier);
      if (candidate.linkedinUrl) score += 35;
      if (candidate.email) score += 20;
      if (domainMatches(candidate, websiteDomain)) score += 45;
      if (context.state && candidate.location?.toLowerCase().includes(context.state.toLowerCase())) score += 10;
      if (candidate.confidence !== null && candidate.confidence !== undefined) score += Math.round(candidate.confidence * 20);
      return { candidate, tier, classification: classifySelection(tier), score };
    })
    .sort((a, b) => b.score - a.score);
}

export function selectBestContact(
  candidates: readonly DiscoveredContactCandidate[],
  context: { websiteDomain?: string | null; state?: string | null } = {},
): RankedContact | null {
  const ranked = rankContactCandidates(candidates, context);
  return ranked.find((r) => r.tier !== "X") ?? ranked[0] ?? null;
}

export function isWeakRole(tier: BuyerTier): boolean {
  return tier === "E" || tier === "X" || tier === "none";
}
