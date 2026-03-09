/**
 * useChatSSE — Server-Sent Events hook for real-time chat updates.
 *
 * Connects to the conversations SSE endpoint and dispatches events
 * to registered listeners. Uses fetch() with Authorization headers
 * instead of EventSource (which doesn't support custom headers).
 */
import { useEffect, useRef, useCallback } from "react";
import { API_BASE } from "@/lib/apiBase";
import { getAuthToken } from "@/lib/api";
import { getFirebaseIdToken } from "@/lib/firebaseClient";

export type ChatSSEEvent =
  | { type: "connected"; data: { uid: string; orgId: string } }
  | { type: "heartbeat"; data: { ts: number } }
  | { type: "message:new"; data: { conversationId: string; message: any } }
  | { type: "conversation:created"; data: { conversation: any } }
  | { type: "conversation:updated"; data: any }
  | { type: "typing"; data: { conversationId: string; uid: string; userName: string } };

type EventHandler = (event: ChatSSEEvent) => void;

/**
 * Hook that maintains an SSE connection and calls `onEvent` for every event.
 * Reconnects automatically on disconnect with exponential backoff.
 */
export function useChatSSE(onEvent: EventHandler) {
  const abortRef = useRef<AbortController | null>(null);
  const retryRef = useRef(0);
  const mountedRef = useRef(true);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  const connect = useCallback(async () => {
    if (!mountedRef.current) return;

    // Abort any existing connection
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      // Get auth token
      let token = await getFirebaseIdToken();
      if (!token) {
        token = getAuthToken();
      }

      const headers: Record<string, string> = {
        Accept: "text/event-stream",
      };
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }

      const res = await fetch(`${API_BASE}/api/edu/conversations/stream`, {
        headers,
        credentials: "include",
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        throw new Error(`SSE connection failed: ${res.status}`);
      }

      // Reset retry counter on successful connection
      retryRef.current = 0;

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (mountedRef.current) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Parse SSE frames from buffer
        const lines = buffer.split("\n");
        buffer = lines.pop() || ""; // Keep incomplete line in buffer

        let currentEvent = "";
        let currentData = "";

        for (const line of lines) {
          if (line.startsWith("event: ")) {
            currentEvent = line.slice(7).trim();
          } else if (line.startsWith("data: ")) {
            currentData = line.slice(6);
          } else if (line === "" && currentEvent && currentData) {
            // End of event — dispatch
            try {
              const parsed = JSON.parse(currentData);
              onEventRef.current({ type: currentEvent, data: parsed } as ChatSSEEvent);
            } catch {
              // Ignore malformed events
            }
            currentEvent = "";
            currentData = "";
          }
        }
      }
    } catch (err: any) {
      if (err?.name === "AbortError") return; // Expected on unmount
      console.warn("[useChatSSE] Connection error:", err?.message);
    }

    // Reconnect with exponential backoff
    if (mountedRef.current) {
      const delay = Math.min(1000 * Math.pow(2, retryRef.current), 30_000);
      retryRef.current++;
      setTimeout(() => {
        if (mountedRef.current) connect();
      }, delay);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    connect();

    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
    };
  }, [connect]);
}
