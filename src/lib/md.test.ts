import { describe, expect, it } from "vitest";
import { renderMarkdown } from "./md";

describe("renderMarkdown", () => {
  it("escapes html", () => {
    expect(renderMarkdown('<img src=x onerror="alert(1)">')).toBe("<p>&lt;img src=x onerror=&quot;alert(1)&quot;&gt;</p>");
  });
  it("renders common syntax", () => {
    const html = renderMarkdown("# Hi\n**bold** and `code`\n\n- a\n- [x] b\n\n> quote");
    expect(html).toContain("<h1>Hi</h1>");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<code>code</code>");
    expect(html).toContain("<ul><li>a</li><li>☑ b</li></ul>");
    expect(html).toContain("<blockquote>quote</blockquote>");
  });
  it("only links safe urls", () => {
    expect(renderMarkdown("[x](javascript:alert(1))")).not.toContain("<a");
    expect(renderMarkdown("[x](https://a.b)")).toContain('href="https://a.b"');
  });
});
