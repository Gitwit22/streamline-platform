/**
 * directComms — helpers for deterministic 1:1 direct call rooms
 * and direct chat threads between two staff members.
 *
 * Uses sorted user-ID pairs so John→Sarah and Sarah→John resolve
 * to the same room/thread, preventing duplicates.
 */
import { apiFetchAuth } from "@/lib/api";

/* ── Deterministic key ───────────────────────────────────────────── */

export function pairKey(uidA: string, uidB: string): string {
  return [uidA, uidB].sort().join("_");
}

export function directChatRoomId(uidA: string, uidB: string): string {
  return `faculty_dm_${pairKey(uidA, uidB)}`;
}

export function directCallRoomId(uidA: string, uidB: string): string {
  return `faculty_call_${pairKey(uidA, uidB)}`;
}

/* ── Staff context passed through navigation ─────────────────────── */

export interface DirectCallTarget {
  uid: string;
  name: string;
  role: string;
  avatar?: string | null;
}

/* ── Get or create a direct chat room (server-side) ──────────────── */

export async function getOrCreateDirectChatRoom(
  targetUserId: string,
): Promise<{ roomId: string; created: boolean }> {
  const res = await apiFetchAuth("/api/edu/chat/rooms/direct", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ targetUserId }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || "Failed to create direct chat room");
  }
  return res.json();
}
