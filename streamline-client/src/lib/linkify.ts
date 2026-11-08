/**
 * Splits plain chat text into text and link segments so links can be rendered
 * as <a> elements without ever injecting HTML.
 *
 * Only http(s) URLs are linked; "www." links get https://. Any other scheme
 * (javascript:, data:, file:, …) stays plain text.
 */
export type LinkSegment =
  | { type: "text"; value: string }
  | { type: "link"; value: string; href: string };

// http(s)://… or www.… up to whitespace or a character that can't be in a URL
// we want to auto-link.
const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>"'`]+/gi;
const TRAILING_PUNCT = /[.,!?;:'"]+$/;

/** Removes trailing punctuation and unbalanced closing brackets from a match. */
function trimUrl(raw: string): string {
  let url = raw;
  for (;;) {
    const before = url;
    url = url.replace(TRAILING_PUNCT, "");
    for (const [open, close] of [["(", ")"], ["[", "]"], ["{", "}"]] as const) {
      if (url.endsWith(close)) {
        const opens = url.split(open).length - 1;
        const closes = url.split(close).length - 1;
        if (closes > opens) url = url.slice(0, -1);
      }
    }
    if (url === before) return url;
  }
}

export function toSafeHref(raw: string): string | null {
  const candidate = /^www\./i.test(raw) ? `https://${raw}` : raw;
  try {
    const u = new URL(candidate);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    if (!u.hostname) return null;
    return u.href;
  } catch {
    return null;
  }
}

export function splitLinks(text: string): LinkSegment[] {
  const input = typeof text === "string" ? text : "";
  const out: LinkSegment[] = [];
  let last = 0;
  const pushText = (value: string) => {
    if (!value) return;
    const prev = out[out.length - 1];
    if (prev && prev.type === "text") prev.value += value;
    else out.push({ type: "text", value });
  };

  for (const m of input.matchAll(URL_RE)) {
    const start = m.index ?? 0;
    const value = trimUrl(m[0]);
    const href = value ? toSafeHref(value) : null;
    pushText(input.slice(last, start));
    if (href) {
      out.push({ type: "link", value, href });
      last = start + value.length;
    } else {
      last = start;
    }
  }
  pushText(input.slice(last));
  return out;
}
