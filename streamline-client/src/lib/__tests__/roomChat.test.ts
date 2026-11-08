import { beforeEach, describe, expect, it } from "vitest";
import {
  CHAT_ATTACHMENT_MAX_BYTES,
  clearChatCache,
  formatBytes,
  normalizeMessage,
  readChatCache,
  validateChatFile,
  writeChatCache,
} from "../roomChat";

describe("validateChatFile", () => {
  it("accepts allowlisted docs up to 25 MB", () => {
    expect(validateChatFile({ name: "Deck.PPTX", size: 1000 })).toBeNull();
    expect(validateChatFile({ name: "notes.pdf", size: CHAT_ATTACHMENT_MAX_BYTES })).toBeNull();
  });
  it("rejects other types, empty and oversized files", () => {
    expect(validateChatFile({ name: "page.html", size: 10 })).toMatch(/can't be shared/);
    expect(validateChatFile({ name: "noext", size: 10 })).toMatch(/can't be shared/);
    expect(validateChatFile({ name: "a.pdf", size: 0 })).toMatch(/empty/);
    expect(validateChatFile({ name: "a.pdf", size: CHAT_ATTACHMENT_MAX_BYTES + 1 })).toMatch(/25 MB/);
  });
});

describe("normalizeMessage", () => {
  it("keeps attachment metadata and stamps the session id", () => {
    const m = normalizeMessage(
      { id: "m1", text: "", createdAtMs: 5, sender: { name: "A" }, attachment: { name: "a.pdf", size: 3, contentType: "application/pdf" } },
      "s1",
    );
    expect(m).toEqual({
      id: "m1",
      text: "",
      createdAtMs: 5,
      sender: { name: "A" },
      attachment: { name: "a.pdf", size: 3, contentType: "application/pdf" },
      sessionId: "s1",
    });
  });
  it("drops rows without an id and tolerates junk", () => {
    expect(normalizeMessage({ text: "x" })).toBeNull();
    expect(normalizeMessage(null)).toBeNull();
    expect(normalizeMessage({ id: "x", text: 5, attachment: "nope" })).toEqual({ id: "x", text: "", createdAtMs: null, sender: undefined });
  });
});

describe("chat cache", () => {
  beforeEach(() => localStorage.clear());

  it("round-trips messages for a room", () => {
    writeChatCache("r1", "s1", [{ id: "a", text: "hi", createdAtMs: 1 }]);
    expect(readChatCache("r1")).toEqual({ sessionId: "s1", messages: [{ id: "a", text: "hi", createdAtMs: 1, sessionId: "s1" }] });
    clearChatCache("r1");
    expect(readChatCache("r1")).toBeNull();
  });

  it("reads caches written by the previous chat panel (same key/shape)", () => {
    localStorage.setItem(
      "sl_chat_r2",
      JSON.stringify({ sessionId: "s9", messages: [{ id: "x", text: "old", createdAtMs: 2, sender: { name: "B" } }], ts: Date.now() }),
    );
    expect(readChatCache("r2")?.messages[0]).toMatchObject({ id: "x", text: "old", sessionId: "s9" });
  });

  it("expires caches older than 12h and caps at 200 messages", () => {
    localStorage.setItem("sl_chat_r3", JSON.stringify({ sessionId: "s", messages: [], ts: Date.now() - 13 * 3600_000 }));
    expect(readChatCache("r3")).toBeNull();
    const many = Array.from({ length: 250 }, (_, i) => ({ id: String(i), text: "", createdAtMs: i }));
    writeChatCache("r4", "s", many);
    const back = readChatCache("r4")!;
    expect(back.messages).toHaveLength(200);
    expect(back.messages[0].id).toBe("50");
  });
});

describe("formatBytes", () => {
  it("formats sizes", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
    expect(formatBytes(0)).toBe("");
  });
});
