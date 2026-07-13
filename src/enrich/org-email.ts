import type { CitedFact } from "./types";

/**
 * Deterministic organization-email fallback.
 *
 * This is deliberately NOT email-pattern guessing. It only returns an address that
 * already appears in the text we scraped from the practice's own public website
 * (including mailto links, once `html-clean.ts` has exposed them). The point is to
 * keep send/CRM flows operational when the decision-maker's direct inbox is not
 * available, without pretending `info@` belongs to the named person.
 */

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

const GENERIC_LOCAL_PARTS = new Set([
  "admin",
  "appointments",
  "billing",
  "care",
  "contact",
  "frontdesk",
  "hello",
  "help",
  "info",
  "office",
  "patientcare",
  "patients",
  "reception",
  "scheduling",
  "support",
]);

const CONTACT_PATH_HINTS = [
  "contact",
  "about",
  "location",
  "appointment",
  "patient",
] as const;

const BAD_LOCAL_PARTS = new Set([
  "abuse",
  "donotreply",
  "example",
  "noreply",
  "no-reply",
  "postmaster",
  "privacy",
  "security",
  "webmaster",
]);

const BAD_DOMAINS = [
  "sentry.io",
  "wixpress.com",
  "wordpress.com",
  "squarespace.com",
  "example.com",
] as const;

export interface OrgEmailFallback extends CitedFact {
  /** True when the local part is role-based/generic, not a named person. */
  roleBased: boolean;
}

function domainOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return null;
  }
}

function emailDomain(email: string): string {
  return email.split("@")[1]?.toLowerCase() ?? "";
}

function emailLocal(email: string): string {
  return email.split("@")[0]?.toLowerCase() ?? "";
}

function isLikelyRoleInbox(local: string): boolean {
  const compact = local.replace(/[^a-z0-9]/g, "");
  return GENERIC_LOCAL_PARTS.has(local) || GENERIC_LOCAL_PARTS.has(compact);
}

function isBadEmail(email: string): boolean {
  const local = emailLocal(email);
  const domain = emailDomain(email);
  if (!local || !domain) return true;
  if (BAD_LOCAL_PARTS.has(local)) return true;
  if (BAD_DOMAINS.some((bad) => domain === bad || domain.endsWith(`.${bad}`))) {
    return true;
  }
  return false;
}

function sameSiteEmail(email: string, websiteUrl: string | null | undefined): boolean {
  const siteDomain = domainOf(websiteUrl);
  if (!siteDomain) return false;
  const domain = emailDomain(email);
  return domain === siteDomain || domain.endsWith(`.${siteDomain}`);
}

function snippetAround(text: string, email: string): string {
  const idx = text.toLowerCase().indexOf(email.toLowerCase());
  if (idx < 0) return email;
  const start = Math.max(0, idx - 80);
  const end = Math.min(text.length, idx + email.length + 80);
  return text.slice(start, end).replace(/\s+/g, " ").trim();
}

interface Candidate {
  email: string;
  sourceUrl: string;
  snippet: string;
  roleBased: boolean;
  score: number;
}

function scoreCandidate(
  email: string,
  sourceUrl: string,
  roleBased: boolean,
  websiteUrl: string | null | undefined,
): number {
  let score = 0;
  if (roleBased) score += 100;
  if (sameSiteEmail(email, websiteUrl)) score += 40;
  const path = sourceUrl.toLowerCase();
  if (CONTACT_PATH_HINTS.some((hint) => path.includes(hint))) score += 20;
  // A named/person-looking address is not an organization fallback. It may still be
  // a valid direct email when the cited decision-maker field supplies it, but this
  // deterministic fallback should not route all mail to a random staff member.
  if (!roleBased) score -= 100;
  return score;
}

export function findOrgEmailFallback(
  pages: Map<string, string>,
  websiteUrl?: string | null,
): OrgEmailFallback | null {
  const byEmail = new Map<string, Candidate>();

  for (const [sourceUrl, text] of pages) {
    const matches = text.matchAll(EMAIL_RE);
    for (const match of matches) {
      const email = match[0].toLowerCase();
      if (isBadEmail(email)) continue;
      const local = emailLocal(email);
      const roleBased = isLikelyRoleInbox(local);
      const candidate: Candidate = {
        email,
        sourceUrl,
        snippet: snippetAround(text, email),
        roleBased,
        score: scoreCandidate(email, sourceUrl, roleBased, websiteUrl),
      };
      const existing = byEmail.get(email);
      if (!existing || candidate.score > existing.score) byEmail.set(email, candidate);
    }
  }

  const best = [...byEmail.values()]
    .filter((candidate) => candidate.roleBased)
    .sort((a, b) => b.score - a.score || a.email.localeCompare(b.email))[0];

  if (!best) return null;
  return {
    value: best.email,
    sourceUrl: best.sourceUrl,
    snippet: best.snippet,
    roleBased: best.roleBased,
  };
}
