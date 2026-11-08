import { describe, expect, it } from "vitest";
import { splitLinks, toSafeHref } from "../linkify";

describe("splitLinks", () => {
  it("returns plain text untouched", () => {
    expect(splitLinks("hello there")).toEqual([{ type: "text", value: "hello there" }]);
    expect(splitLinks("")).toEqual([]);
  });

  it("links http(s) URLs inside text", () => {
    expect(splitLinks("see https://example.com/a?b=1 now")).toEqual([
      { type: "text", value: "see " },
      { type: "link", value: "https://example.com/a?b=1", href: "https://example.com/a?b=1" },
      { type: "text", value: " now" },
    ]);
  });

  it("adds https:// to www links", () => {
    const segs = splitLinks("go to www.example.com");
    expect(segs[1]).toEqual({ type: "link", value: "www.example.com", href: "https://www.example.com/" });
  });

  it("drops trailing punctuation and unbalanced parens", () => {
    expect(splitLinks("(https://example.com/x).")).toEqual([
      { type: "text", value: "(" },
      { type: "link", value: "https://example.com/x", href: "https://example.com/x" },
      { type: "text", value: ")." },
    ]);
    const wiki = splitLinks("https://en.wikipedia.org/wiki/Foo_(bar), ok");
    expect(wiki[0]).toMatchObject({ type: "link", value: "https://en.wikipedia.org/wiki/Foo_(bar)" });
  });

  it("never links non-http schemes", () => {
    for (const t of ["javascript:alert(1)", "data:text/html,<b>x</b>", "file:///etc/passwd", "ftp://x.com"]) {
      expect(splitLinks(t).every((s) => s.type === "text")).toBe(true);
    }
  });

  it("handles multiple links and keeps text joined", () => {
    const segs = splitLinks("a https://a.com b http://b.com");
    expect(segs.map((s) => s.type)).toEqual(["text", "link", "text", "link"]);
    expect(segs.map((s) => s.value).join("")).toBe("a https://a.com b http://b.com");
  });
});

describe("toSafeHref", () => {
  it("accepts only http/https with a host", () => {
    expect(toSafeHref("https://x.com")).toBe("https://x.com/");
    expect(toSafeHref("javascript:alert(1)")).toBeNull();
    expect(toSafeHref("http://")).toBeNull();
  });
});
