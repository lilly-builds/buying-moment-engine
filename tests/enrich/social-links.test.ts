import { describe, expect, it } from "vitest";
import { extractCompanySocialLinks } from "@/src/enrich/social-links";

describe("extractCompanySocialLinks", () => {
  it("captures company LinkedIn, Facebook, and Instagram pages", () => {
    const links = extractCompanySocialLinks([
      {
        sourceUrl: "https://practice.example/",
        html: `
          <a href="https://www.linkedin.com/company/example-practice/?trk=public_post_share-update_actor-image"></a>
          <a href="https://facebook.com/example.practice?ref=footer"></a>
          <a href="https://instagram.com/examplepractice/"></a>
        `,
      },
    ]);

    expect(links.linkedinUrl).toBe("https://www.linkedin.com/company/example-practice");
    expect(links.facebookUrl).toBe("https://www.facebook.com/example.practice");
    expect(links.instagramUrl).toBe("https://www.instagram.com/examplepractice");
    expect(links.sources.linkedin).toBe("https://practice.example/");
  });

  it("ignores person LinkedIn and generic share links", () => {
    const links = extractCompanySocialLinks([
      {
        sourceUrl: "https://practice.example/",
        html: `
          <a href="https://linkedin.com/in/jane-doe"></a>
          <a href="https://facebook.com/sharer/sharer.php?u=https://practice.example"></a>
          <a href="https://instagram.com/p/abc123"></a>
        `,
      },
    ]);

    expect(links.linkedinUrl).toBeNull();
    expect(links.facebookUrl).toBeNull();
    expect(links.instagramUrl).toBeNull();
  });
});
