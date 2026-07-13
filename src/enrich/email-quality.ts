import type { EmailQuality } from "./types";

const PERSONAL_DOMAINS = new Set([
  "gmail.com",
  "yahoo.com",
  "aol.com",
  "hotmail.com",
  "outlook.com",
  "icloud.com",
  "me.com",
  "msn.com",
]);

export function domainOfEmail(email: string | null | undefined): string | null {
  const match = email?.trim().toLowerCase().match(/^[^@\s]+@([^@\s]+)$/);
  return match ? match[1] : null;
}

export function isPersonalEmail(email: string | null | undefined): boolean {
  const domain = domainOfEmail(email);
  return domain ? PERSONAL_DOMAINS.has(domain) : false;
}

export function normalizeFullEnrichEmailQuality(status: string | null | undefined, email: string | null | undefined): EmailQuality {
  if (!email) return "none";
  if (isPersonalEmail(email)) return "personal";
  const normalized = status?.trim().toUpperCase();
  if (normalized === "DELIVERABLE") return "safe_work";
  if (normalized === "HIGH_PROBABILITY") return "weak_work";
  return "weak_work";
}

export function normalizeBetterContactEmailQuality(status: string | null | undefined, email: string | null | undefined): EmailQuality {
  if (!email) return "none";
  if (isPersonalEmail(email)) return "personal";
  const normalized = status?.trim().toLowerCase();
  if (["deliverable", "valid", "catch_all_safe"].includes(normalized ?? "")) return "safe_work";
  return "weak_work";
}

export function shouldUseBetterContactFallback(quality: EmailQuality): boolean {
  return quality !== "safe_work";
}
