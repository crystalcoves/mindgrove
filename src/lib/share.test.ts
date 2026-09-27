import { describe, expect, it } from "vitest";
import { shareToText } from "./share";

const q = (o: Record<string, string>) => new URLSearchParams(o);

describe("shareToText", () => {
  it("joins title, text and url without repeats", () => {
    expect(shareToText(q({ title: "Great article", text: "Read this https://a.b/c", url: "https://a.b/c" }))).toBe(
      "Great article — Read this https://a.b/c",
    );
    expect(shareToText(q({ url: "https://x.y" }))).toBe("https://x.y");
    expect(shareToText(q({ title: "Same", text: "Same" }))).toBe("Same");
  });
  it("returns null when nothing was shared", () => {
    expect(shareToText(q({}))).toBeNull();
  });
});
