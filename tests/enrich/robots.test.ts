import { describe, expect, it } from "vitest";
import { ALLOW_ALL, isAllowed, parseRobotsTxt } from "@/src/enrich/robots";

/** Pure. `scrape.ts` fetches the file; these functions only decide. */

describe("parseRobotsTxt — resolving the `User-agent: *` group", () => {
  it("`Disallow: /` denies every path", () => {
    const policy = parseRobotsTxt("User-agent: *\nDisallow: /");
    expect(policy.disallow).toEqual(["/"]);
    expect(isAllowed(policy, "/")).toBe(false);
    expect(isAllowed(policy, "/about")).toBe(false);
    expect(isAllowed(policy, "/team/joel")).toBe(false);
  });

  it("a prefix denies below it and nothing else", () => {
    const policy = parseRobotsTxt("User-agent: *\nDisallow: /wp-admin");
    expect(isAllowed(policy, "/wp-admin")).toBe(false);
    expect(isAllowed(policy, "/wp-admin/x")).toBe(false);
    expect(isAllowed(policy, "/about")).toBe(true);
  });

  it("a group for a DIFFERENT user-agent leaves our paths allowed", () => {
    const policy = parseRobotsTxt("User-agent: badbot\nDisallow: /");
    expect(policy.disallow).toEqual([]);
    expect(isAllowed(policy, "/anything")).toBe(true);
  });

  it("a new user-agent AFTER a rule line ends our group", () => {
    const policy = parseRobotsTxt(
      "User-agent: *\nDisallow: /private\nUser-agent: badbot\nDisallow: /team",
    );
    expect(policy.disallow).toEqual(["/private"]);
    expect(isAllowed(policy, "/team")).toBe(true);
  });

  it("consecutive user-agent lines address ONE group", () => {
    const policy = parseRobotsTxt(
      "User-agent: googlebot\nUser-agent: *\nDisallow: /private",
    );
    expect(policy.disallow).toEqual(["/private"]);
    expect(isAllowed(policy, "/private/x")).toBe(false);
  });

  it("ignores `#` comments, inline comments, and blank lines", () => {
    const policy = parseRobotsTxt(
      [
        "# a comment",
        "",
        "User-agent: *   # everyone",
        "   ",
        "Disallow: /private  # keep out",
        "Sitemap: https://example.com/sitemap.xml",
      ].join("\n"),
    );
    expect(policy.disallow).toEqual(["/private"]);
  });

  it("is case-insensitive about directive names", () => {
    const policy = parseRobotsTxt("USER-AGENT: *\nDISALLOW: /private");
    expect(policy.disallow).toEqual(["/private"]);
  });

  it("EDGE CASE: a bare `Disallow:` allows everything — it is not the empty prefix", () => {
    // `''` would `startsWith`-match every path on earth. This is the whole test.
    const policy = parseRobotsTxt("User-agent: *\nDisallow:");
    expect(policy.disallow).toEqual([]);
    expect(isAllowed(policy, "/about")).toBe(true);
  });

  it("EDGE CASE: an empty file, or one with no directives, allows everything", () => {
    expect(parseRobotsTxt("")).toEqual(ALLOW_ALL);
    expect(parseRobotsTxt("garbage without a colon")).toEqual(ALLOW_ALL);
    expect(isAllowed(parseRobotsTxt(""), "/about")).toBe(true);
  });

  it("handles CRLF line endings", () => {
    const policy = parseRobotsTxt("User-agent: *\r\nDisallow: /private\r\n");
    expect(policy.disallow).toEqual(["/private"]);
  });
});

describe("isAllowed — the decision", () => {
  it("a missing / unfetchable robots.txt means ALLOW (the convention)", () => {
    expect(isAllowed(null, "/anything")).toBe(true);
  });

  it("query strings and fragments are not part of the match", () => {
    const policy = parseRobotsTxt("User-agent: *\nDisallow: /search");
    expect(isAllowed(policy, "/search?q=derm")).toBe(false);
    expect(isAllowed(policy, "/about?ref=nav")).toBe(true);
    expect(isAllowed(policy, "/about#team")).toBe(true);
  });

  it("normalizes a scheme-less path to a leading slash before matching", () => {
    const policy = parseRobotsTxt("User-agent: *\nDisallow: /private");
    expect(isAllowed(policy, "private/x")).toBe(false);
  });
});
