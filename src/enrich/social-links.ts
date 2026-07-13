import * as cheerio from "cheerio";

export interface CompanySocialLinks {
  linkedinUrl: string | null;
  facebookUrl: string | null;
  instagramUrl: string | null;
  sources: Record<"linkedin" | "facebook" | "instagram", string | null>;
}

const EMPTY_SOCIAL_LINKS: CompanySocialLinks = {
  linkedinUrl: null,
  facebookUrl: null,
  instagramUrl: null,
  sources: { linkedin: null, facebook: null, instagram: null },
};

function cleanUrl(raw: string): URL | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  try {
    const parsed = new URL(trimmed.startsWith("//") ? `https:${trimmed}` : trimmed);
    parsed.hash = "";
    parsed.search = "";
    return parsed;
  } catch {
    return null;
  }
}

function normalizeLinkedin(parsed: URL): string | null {
  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  if (host !== "linkedin.com") return null;
  const path = parsed.pathname.replace(/\/+$/, "");
  const lower = path.toLowerCase();
  if (!lower.startsWith("/company/") && !lower.startsWith("/school/")) return null;
  if (lower.includes("/share") || lower.includes("/feed/")) return null;
  return `https://www.linkedin.com${path}`;
}

function normalizeFacebook(parsed: URL): string | null {
  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  if (host !== "facebook.com" && host !== "fb.com") return null;
  const path = parsed.pathname.replace(/\/+$/, "");
  const lower = path.toLowerCase();
  if (
    path === "" ||
    path === "/" ||
    lower.startsWith("/sharer") ||
    lower.startsWith("/share") ||
    lower.startsWith("/plugins") ||
    lower === "/login"
  ) {
    return null;
  }
  return `https://www.facebook.com${path}`;
}

function normalizeInstagram(parsed: URL): string | null {
  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  if (host !== "instagram.com") return null;
  const path = parsed.pathname.replace(/\/+$/, "");
  const lower = path.toLowerCase();
  if (path === "" || path === "/" || lower.startsWith("/p/") || lower.startsWith("/reel/")) {
    return null;
  }
  return `https://www.instagram.com${path}`;
}

export function extractCompanySocialLinks(
  pages: Iterable<{ sourceUrl: string; html: string }>,
): CompanySocialLinks {
  const result: CompanySocialLinks = {
    linkedinUrl: null,
    facebookUrl: null,
    instagramUrl: null,
    sources: { linkedin: null, facebook: null, instagram: null },
  };

  for (const page of pages) {
    const $ = cheerio.load(page.html);
    $("a[href]").each((_, el) => {
      const href = $(el).attr("href");
      if (!href) return;
      const parsed = cleanUrl(href);
      if (!parsed) return;

      if (!result.linkedinUrl) {
        const normalized = normalizeLinkedin(parsed);
        if (normalized) {
          result.linkedinUrl = normalized;
          result.sources.linkedin = page.sourceUrl;
        }
      }
      if (!result.facebookUrl) {
        const normalized = normalizeFacebook(parsed);
        if (normalized) {
          result.facebookUrl = normalized;
          result.sources.facebook = page.sourceUrl;
        }
      }
      if (!result.instagramUrl) {
        const normalized = normalizeInstagram(parsed);
        if (normalized) {
          result.instagramUrl = normalized;
          result.sources.instagram = page.sourceUrl;
        }
      }
    });
  }

  return result.linkedinUrl || result.facebookUrl || result.instagramUrl
    ? result
    : EMPTY_SOCIAL_LINKS;
}
