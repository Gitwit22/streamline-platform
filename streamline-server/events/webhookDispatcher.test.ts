/**
 * Unit tests for events/webhookDispatcher.ts
 *
 * These tests verify configuration checks and dispatch logic without
 * making real HTTP requests.  We mock `fetch` via globalThis.
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { dispatchEvent } from "./webhookDispatcher";
import { createEventPayload } from "./eventTypes";

// ---------------------------------------------------------------------------
// Helpers to control env vars per test
// ---------------------------------------------------------------------------
const originalEnv: Record<string, string | undefined> = {};

function setEnv(vars: Record<string, string>) {
  for (const [k, v] of Object.entries(vars)) {
    originalEnv[k] = process.env[k];
    process.env[k] = v;
  }
}

function restoreEnv() {
  for (const [k, v] of Object.entries(originalEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

// ---------------------------------------------------------------------------
// Minimal fetch mock
// ---------------------------------------------------------------------------
let fetchCalls: Array<{ url: string; opts: any }> = [];
let fetchResponse = { ok: true, status: 200, text: async () => "ok" };
const originalFetch = globalThis.fetch;

function mockFetch() {
  fetchCalls = [];
  (globalThis as any).fetch = async (url: string, opts: any) => {
    fetchCalls.push({ url, opts });
    return fetchResponse;
  };
}

function restoreFetch() {
  globalThis.fetch = originalFetch;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("webhookDispatcher", () => {
  beforeEach(() => {
    mockFetch();
  });

  afterEach(() => {
    restoreFetch();
    restoreEnv();
  });

  it("does nothing when STREAMLINE_HOOKS_ENABLED is not true", async () => {
    setEnv({
      STREAMLINE_HOOKS_ENABLED: "false",
      STREAMLINE_WEBHOOK_SECRET: "s3cret",
      STREAMLINE_CHAT_EVENT_URL: "http://localhost:9999/chat",
    });

    await dispatchEvent(createEventPayload("chat.message.created"));
    assert.equal(fetchCalls.length, 0);
  });

  it("does nothing when secret is missing", async () => {
    setEnv({
      STREAMLINE_HOOKS_ENABLED: "true",
      STREAMLINE_CHAT_EVENT_URL: "http://localhost:9999/chat",
    });
    delete process.env.STREAMLINE_WEBHOOK_SECRET;

    await dispatchEvent(createEventPayload("chat.message.created"));
    assert.equal(fetchCalls.length, 0);
  });

  it("does nothing when no destination URL is configured for the category", async () => {
    setEnv({
      STREAMLINE_HOOKS_ENABLED: "true",
      STREAMLINE_WEBHOOK_SECRET: "s3cret",
    });
    // No STREAMLINE_CHAT_EVENT_URL set
    delete process.env.STREAMLINE_CHAT_EVENT_URL;

    await dispatchEvent(createEventPayload("chat.message.created"));
    assert.equal(fetchCalls.length, 0);
  });

  it("sends POST to configured URL when enabled", async () => {
    setEnv({
      STREAMLINE_HOOKS_ENABLED: "true",
      STREAMLINE_WEBHOOK_SECRET: "s3cret",
      STREAMLINE_CHAT_EVENT_URL: "http://hook.test/chat",
      STREAMLINE_WEBHOOK_RETRY_COUNT: "1",
    });

    const payload = createEventPayload("chat.message.created", {
      roomId: "room_1",
      entityId: "msg_1",
    });

    await dispatchEvent(payload);

    assert.equal(fetchCalls.length, 1);
    assert.equal(fetchCalls[0].url, "http://hook.test/chat");
    assert.equal(fetchCalls[0].opts.method, "POST");

    // Verify headers
    const headers = fetchCalls[0].opts.headers;
    assert.equal(headers["Content-Type"], "application/json");
    assert.equal(headers["X-Streamline-Event"], "chat.message.created");
    assert.ok(headers["X-Streamline-Signature"].startsWith("sha256="));
    assert.ok(headers["X-Streamline-Timestamp"]);
  });

  it("routes support events to the support URL", async () => {
    setEnv({
      STREAMLINE_HOOKS_ENABLED: "true",
      STREAMLINE_WEBHOOK_SECRET: "s3cret",
      STREAMLINE_SUPPORT_EVENT_URL: "http://hook.test/support",
      STREAMLINE_WEBHOOK_RETRY_COUNT: "1",
    });

    await dispatchEvent(
      createEventPayload("support.ticket.created", { entityId: "ticket_1" })
    );

    assert.equal(fetchCalls.length, 1);
    assert.equal(fetchCalls[0].url, "http://hook.test/support");
  });

  it("routes room events to the room URL", async () => {
    setEnv({
      STREAMLINE_HOOKS_ENABLED: "true",
      STREAMLINE_WEBHOOK_SECRET: "s3cret",
      STREAMLINE_ROOM_EVENT_URL: "http://hook.test/room",
      STREAMLINE_WEBHOOK_RETRY_COUNT: "1",
    });

    await dispatchEvent(
      createEventPayload("room.created", { roomId: "r1" })
    );

    assert.equal(fetchCalls.length, 1);
    assert.equal(fetchCalls[0].url, "http://hook.test/room");
  });

  it("retries on non-ok response (up to configured count)", async () => {
    fetchResponse = { ok: false, status: 502, text: async () => "bad gateway" };

    setEnv({
      STREAMLINE_HOOKS_ENABLED: "true",
      STREAMLINE_WEBHOOK_SECRET: "s3cret",
      STREAMLINE_ALERT_EVENT_URL: "http://hook.test/alert",
      STREAMLINE_WEBHOOK_RETRY_COUNT: "2",
      STREAMLINE_WEBHOOK_TIMEOUT_MS: "500",
    });

    await dispatchEvent(
      createEventPayload("alert.created", { entityId: "a1" })
    );

    // Should have retried: 2 attempts total
    assert.equal(fetchCalls.length, 2);

    // Reset fetch response for other tests
    fetchResponse = { ok: true, status: 200, text: async () => "ok" };
  });
});
