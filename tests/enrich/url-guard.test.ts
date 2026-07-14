import { describe, expect, it } from "vitest";
import {
  BlockedUrlError,
  assertFetchableUrl,
  guardedFetch,
  isBlockedAddress,
} from "@/src/enrich/url-guard";

/**
 * SSRF guard (COV-04). The scraper fetches DB-supplied URLs and follows redirects;
 * without this guard a `websiteUrl` (or a redirect hop) pointing at cloud metadata
 * (169.254.169.254), loopback, or a private range makes the server fetch internal
 * endpoints. These tests are the contract that closes that hole.
 *
 * Hermetic: no real DNS or network. The DNS resolver is injected; `guardedFetch`
 * takes an injected fetch.
 */

describe("isBlockedAddress — private/loopback/link-local/metadata IPs are refused", () => {
  it("blocks the cloud-metadata IMDS address", () => {
    expect(isBlockedAddress("169.254.169.254")).toBe(true);
  });

  it("blocks IPv4 loopback, private, link-local and unspecified ranges", () => {
    for (const ip of [
      "127.0.0.1",
      "127.9.9.9",
      "10.0.0.5",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "169.254.0.1",
      "0.0.0.0",
    ]) {
      expect(isBlockedAddress(ip), ip).toBe(true);
    }
  });

  it("blocks IPv6 loopback, unspecified, link-local, ULA and mapped-IPv4 internal", () => {
    for (const ip of ["::1", "::", "fe80::1", "fc00::1", "fd12:3456::1", "::ffff:127.0.0.1"]) {
      expect(isBlockedAddress(ip), ip).toBe(true);
    }
  });

  it("allows real public addresses", () => {
    for (const ip of ["8.8.8.8", "1.1.1.1", "93.184.216.34", "2606:4700:4700::1111"]) {
      expect(isBlockedAddress(ip), ip).toBe(false);
    }
  });

  it("blocks the just-outside-private boundary correctly (172.15 public, 172.16 private)", () => {
    expect(isBlockedAddress("172.15.0.1")).toBe(false);
    expect(isBlockedAddress("172.16.0.1")).toBe(true);
    expect(isBlockedAddress("172.32.0.1")).toBe(false);
  });
});

describe("assertFetchableUrl — rejects before any request is made", () => {
  const publicLookup = async () => ["93.184.216.34"];

  it("rejects a non-http(s) scheme", async () => {
    await expect(assertFetchableUrl("file:///etc/passwd")).rejects.toBeInstanceOf(BlockedUrlError);
  });

  it("rejects a literal metadata / loopback / private host with no DNS needed", async () => {
    await expect(assertFetchableUrl("http://169.254.169.254/latest/meta-data/")).rejects.toBeInstanceOf(
      BlockedUrlError,
    );
    await expect(assertFetchableUrl("http://127.0.0.1:8080/")).rejects.toBeInstanceOf(BlockedUrlError);
    await expect(assertFetchableUrl("http://10.0.0.1/")).rejects.toBeInstanceOf(BlockedUrlError);
  });

  it("rejects the literal hostname 'localhost'", async () => {
    await expect(assertFetchableUrl("http://localhost/")).rejects.toBeInstanceOf(BlockedUrlError);
  });

  it("rejects a DNS name that resolves to a private address", async () => {
    const rebinding = async () => ["10.0.0.7"];
    await expect(
      assertFetchableUrl("https://evil.example.com/", { lookup: rebinding }),
    ).rejects.toBeInstanceOf(BlockedUrlError);
  });

  it("allows a public host (with or without DNS resolution)", async () => {
    await expect(assertFetchableUrl("https://example.com/")).resolves.toBeUndefined();
    await expect(
      assertFetchableUrl("https://example.com/", { lookup: publicLookup }),
    ).resolves.toBeUndefined();
  });

  it("fails CLOSED when a configured resolver errors (an unverifiable host is refused)", async () => {
    const brokenLookup = async () => {
      throw new Error("SERVFAIL");
    };
    await expect(
      assertFetchableUrl("https://unresolvable.example/", { lookup: brokenLookup }),
    ).rejects.toBeInstanceOf(BlockedUrlError);
  });
});

describe("guardedFetch — validates the initial URL and every redirect hop", () => {
  it("never calls fetch when the initial URL is blocked", async () => {
    let called = 0;
    const fetchImpl = (async () => {
      called++;
      return new Response("", { status: 200 });
    }) as unknown as typeof fetch;

    await expect(guardedFetch(fetchImpl, "http://169.254.169.254/")).rejects.toBeInstanceOf(
      BlockedUrlError,
    );
    expect(called).toBe(0);
  });

  it("refuses to follow a redirect that points at an internal address", async () => {
    const requested: string[] = [];
    const fetchImpl = (async (input: string) => {
      requested.push(input);
      // Public origin 302s to the metadata endpoint — the classic redirect-based SSRF.
      return new Response("", {
        status: 302,
        headers: { location: "http://169.254.169.254/latest/meta-data/" },
      });
    }) as unknown as typeof fetch;

    await expect(guardedFetch(fetchImpl, "https://example.com/")).rejects.toBeInstanceOf(
      BlockedUrlError,
    );
    // It fetched the public origin, saw the redirect, and refused BEFORE fetching the internal hop.
    expect(requested).toEqual(["https://example.com/"]);
  });

  it("follows a same-site redirect and reports the final URL", async () => {
    const fetchImpl = (async (input: string) => {
      if (input === "https://example.com/") {
        return new Response("", { status: 301, headers: { location: "https://www.example.com/" } });
      }
      return new Response("<html>ok</html>", { status: 200 });
    }) as unknown as typeof fetch;

    const { response, finalUrl } = await guardedFetch(fetchImpl, "https://example.com/");
    expect(response.status).toBe(200);
    expect(finalUrl).toBe("https://www.example.com/");
  });

  it("passes a non-redirect response straight through with its final URL", async () => {
    const fetchImpl = (async () => new Response("<html>ok</html>", { status: 200 })) as unknown as typeof fetch;
    const { response, finalUrl } = await guardedFetch(fetchImpl, "https://example.com/page");
    expect(response.status).toBe(200);
    expect(finalUrl).toBe("https://example.com/page");
  });
});
