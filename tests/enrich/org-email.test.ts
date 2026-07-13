import { describe, expect, it } from "vitest";
import { cleanHtml } from "@/src/enrich/html-clean";
import { findOrgEmailFallback } from "@/src/enrich/org-email";

const pages = (entries: Array<[string, string]>) => new Map(entries);

describe("findOrgEmailFallback", () => {
  it("uses only published role-based inboxes, never guessed patterns", () => {
    const result = findOrgEmailFallback(
      pages([
        [
          "https://clinic.example/contact",
          "Contact our office at office@clinic.example for appointments.",
        ],
      ]),
      "https://clinic.example",
    );

    expect(result?.value).toBe("office@clinic.example");
    expect(result?.sourceUrl).toBe("https://clinic.example/contact");
    expect(result?.snippet).toContain("office@clinic.example");
  });

  it("does not turn a random staff email into an organization fallback", () => {
    expect(
      findOrgEmailFallback(
        pages([["https://clinic.example/team", "Jane Smith jane.smith@clinic.example"]]),
        "https://clinic.example",
      ),
    ).toBeNull();
  });

  it("exposes mailto-only addresses during HTML cleaning", () => {
    const text = cleanHtml(
      '<main><h1>Contact</h1><p>Email our office <a href="mailto:info@clinic.example">here</a> for help.</p><p>Appointments available Monday.</p></main>',
    );
    expect(text).toContain("info@clinic.example");
    expect(findOrgEmailFallback(pages([["https://clinic.example/contact", text]]))?.value).toBe(
      "info@clinic.example",
    );
  });
});
