import type { Recipient, RecipientClassification } from "./adapter";

/**
 * D9 send firewall (R7/D9, U11). The demo NEVER fires an email at a real practice
 * — "actions are simulated; nothing sends, no practice is ever contacted." This
 * module is the structural enforcement of that promise, called as the FIRST line
 * of every send binding, before any network I/O. A blocked send throws here, so a
 * network-spy test can prove zero calls left the process.
 *
 * Two conditions, BOTH required (fail-closed):
 *   1. the caller explicitly classified the recipient `sandbox`, and
 *   2. the address itself is a recognised non-production sandbox address.
 *
 * Requiring the address check on TOP of the classification is deliberate: a
 * single mislabeled `sandbox` flag on a real contact must still not send. The
 * address is ground truth the caller cannot fake by flipping one field.
 */

export class RealPracticeSendBlockedError extends Error {
  constructor(reason: string) {
    // Never include the address itself — an error surfaced to a client must not
    // leak a contact's email (D9). The reason names the rule, not the value.
    super(`Send blocked by D9 firewall: ${reason}`);
    this.name = "RealPracticeSendBlockedError";
  }
}

/**
 * What counts as a sandbox address. Empty by default → NOTHING is sendable until
 * the operator registers the demo's own test contacts (U15 wires the real dev-
 * account addresses). Fail-closed: an unconfigured guard blocks every send.
 *
 * `allowSubaddressTag` treats an RFC-5233 `+sandbox` local-part tag as a sandbox
 * marker (e.g. `qa+sandbox@gmail.com`), which is a convenient way to mint test
 * addresses on an inbox you already control.
 */
export interface SandboxConfig {
  /** Exact addresses that are sandbox (case-insensitive). */
  allowedEmails?: readonly string[];
  /** Whole domains that are sandbox, e.g. "example.com" (case-insensitive). */
  allowedDomains?: readonly string[];
  /** Treat a `+sandbox` sub-address tag as a sandbox marker (default false). */
  allowSubaddressTag?: boolean;
}

const SUBADDRESS_SANDBOX_TAG = "sandbox";

function domainOf(email: string): string | null {
  const at = email.lastIndexOf("@");
  if (at < 0 || at === email.length - 1) return null;
  return email.slice(at + 1).toLowerCase();
}

function localPartOf(email: string): string | null {
  const at = email.lastIndexOf("@");
  return at <= 0 ? null : email.slice(0, at).toLowerCase();
}

/** Is this address a recognised sandbox/test address under `config`? (pure) */
export function isSandboxEmail(email: string, config: SandboxConfig): boolean {
  const addr = email.trim().toLowerCase();
  if (!addr || !addr.includes("@")) return false;

  const allowed = config.allowedEmails?.map((e) => e.trim().toLowerCase()) ?? [];
  if (allowed.includes(addr)) return true;

  const domain = domainOf(addr);
  if (domain) {
    const domains = config.allowedDomains?.map((d) => d.trim().toLowerCase()) ?? [];
    if (domains.includes(domain)) return true;
  }

  if (config.allowSubaddressTag) {
    const local = localPartOf(addr);
    // Match a `+sandbox` tag exactly (not a substring like `+sandboxed`).
    if (local && local.split("+").slice(1).includes(SUBADDRESS_SANDBOX_TAG)) {
      return true;
    }
  }

  return false;
}

/**
 * Throw unless an (address, classification) target is safe to send to (D9). Both
 * the explicit `sandbox` classification AND the address check must pass. This is
 * the address-level twin of `assertSandboxRecipient`, split out so the send route
 * can run the firewall on the recipient it resolved SERVER-SIDE *before* any
 * network I/O — i.e. before the CRM push that mints the provider `contactId`. Both
 * entry points share this one implementation, so neither condition can drift.
 */
export function assertSandboxTarget(
  target: { email: string; classification: RecipientClassification },
  config: SandboxConfig,
): void {
  if (target.classification !== "sandbox") {
    throw new RealPracticeSendBlockedError(
      "recipient is not classified as a sandbox contact",
    );
  }
  if (!isSandboxEmail(target.email, config)) {
    throw new RealPracticeSendBlockedError(
      "recipient address is not a registered sandbox address",
    );
  }
}

/**
 * Throw unless `recipient` is safe to send to (D9). Both the explicit `sandbox`
 * classification AND the address check must pass. Call this before ANY I/O.
 */
export function assertSandboxRecipient(
  recipient: Recipient,
  config: SandboxConfig,
): void {
  assertSandboxTarget(recipient, config);
}
