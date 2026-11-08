import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ChatComposer, ChatMessageList } from "../RoomChat";
import type { RoomChatState } from "../../hooks/useRoomChat";

afterEach(cleanup);

function fakeChat(overrides: Partial<RoomChatState> = {}): RoomChatState {
  return {
    enabled: true,
    canUpload: true,
    sessionId: "s1",
    messages: [],
    loading: false,
    uploading: false,
    error: null,
    clearError: vi.fn(),
    reportError: vi.fn(),
    refresh: vi.fn(async () => {}),
    sendText: vi.fn(async () => true),
    sendFile: vi.fn(async () => true),
    endSession: vi.fn(async () => true),
    downloadAttachment: vi.fn(async () => {}),
    unreadCount: 0,
    markRead: vi.fn(),
    ...overrides,
  };
}

describe("ChatMessageList", () => {
  it("renders links as new-tab anchors and keeps unsafe schemes as text", () => {
    const chat = fakeChat({
      messages: [
        { id: "1", text: "agenda https://example.com/doc and javascript:alert(1)", createdAtMs: 1, sender: { name: "Ann" } },
      ],
    });
    render(<ChatMessageList chat={chat} />);
    const link = screen.getByRole("link", { name: "https://example.com/doc" });
    expect(link.getAttribute("href")).toBe("https://example.com/doc");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
    expect(link.getAttribute("rel")).toContain("noreferrer");
    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(screen.getByText(/javascript:alert\(1\)/)).toBeTruthy();
  });

  it("shows attachments with a download button", () => {
    const msg = { id: "2", text: "", createdAtMs: 1, sessionId: "s1", attachment: { name: "plan.pdf", size: 2048, contentType: "application/pdf" } };
    const chat = fakeChat({ messages: [msg] });
    render(<ChatMessageList chat={chat} />);
    expect(screen.getByText("plan.pdf")).toBeTruthy();
    expect(screen.getByText("2.0 KB")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Download plan.pdf" }));
    expect(chat.downloadAttachment).toHaveBeenCalledWith(msg);
  });
});

describe("ChatComposer", () => {
  it("sends text and clears the draft on success", async () => {
    const chat = fakeChat();
    render(<ChatComposer chat={chat} />);
    const input = screen.getByPlaceholderText("Type a message…");
    fireEvent.change(input, { target: { value: "hello" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(chat.sendText).toHaveBeenCalledWith("hello"));
    await waitFor(() => expect((input as HTMLInputElement).value).toBe(""));
  });

  it("keeps the draft when sending fails", async () => {
    const chat = fakeChat({ sendText: vi.fn(async () => false) });
    render(<ChatComposer chat={chat} />);
    const input = screen.getByPlaceholderText("Type a message…") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "keep me" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(chat.sendText).toHaveBeenCalled());
    expect(input.value).toBe("keep me");
  });

  it("attaches a file and sends it with the note as caption", async () => {
    const chat = fakeChat();
    render(<ChatComposer chat={chat} />);
    const file = new File(["%PDF"], "agenda.pdf", { type: "application/pdf" });
    fireEvent.change(screen.getByTestId("chat-file-input"), { target: { files: [file] } });
    expect(screen.getByTestId("chat-pending-file").textContent).toContain("agenda.pdf");
    fireEvent.change(screen.getByPlaceholderText("Add a note (optional)…"), { target: { value: "read before" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(chat.sendFile).toHaveBeenCalledWith(file, "read before"));
  });

  it("rejects disallowed files before upload", () => {
    const chat = fakeChat();
    render(<ChatComposer chat={chat} />);
    const file = new File(["<html>"], "x.html", { type: "text/html" });
    fireEvent.change(screen.getByTestId("chat-file-input"), { target: { files: [file] } });
    expect(chat.reportError).toHaveBeenCalled();
    expect(screen.queryByTestId("chat-pending-file")).toBeNull();
  });

  it("hides the attach button for read-only/no-upload users", () => {
    render(<ChatComposer chat={fakeChat({ canUpload: false })} />);
    expect(screen.queryByRole("button", { name: "Attach a file" })).toBeNull();
  });
});
