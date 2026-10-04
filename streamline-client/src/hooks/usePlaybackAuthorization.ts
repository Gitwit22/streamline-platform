import { useCallback, useEffect, useRef, useState } from "react";
import { API_BASE } from "../lib/apiBase";
import { apiFetchOptionalAuth } from "../lib/api";
import {
  interpretPlaybackResponse,
  nextPlayerUrl,
  playbackRenewDelayMs,
  playbackTokenOf,
  type PlaybackGate,
} from "../lib/playbackAccess";

export type PlaybackTarget = { kind: "channel"; id: string } | { kind: "room"; id: string };

export type PlaybackFetcher = (path: string) => Promise<{ status: number; body: any }>;

const defaultFetcher: PlaybackFetcher = async (path) => {
  const res = await apiFetchOptionalAuth(path, { method: "POST", body: "{}", headers: { "Content-Type": "application/json" } });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
};

export function playbackPath(target: PlaybackTarget): string {
  return target.kind === "channel"
    ? `/api/public/channels/${encodeURIComponent(target.id)}/playback`
    : `/api/public/rooms/${encodeURIComponent(target.id)}/playback`;
}

/**
 * Server-side playback authorization for a channel / room.
 *
 * - `active`: ask the server (the channel is not public, or the page needs
 *   the decision). Inactive → gate "idle", no requests.
 * - `live`: the stream is live; re-asks when it goes live so the viewer gets
 *   a URL, and drops the URL when it stops.
 * - Signed URLs are renewed at ~2/3 of their lifetime. With hls.js the
 *   player URL stays stable and `tokenRef` carries the fresh token (swap it
 *   in xhrSetup); native HLS gets the new URL.
 */
export function usePlaybackAuthorization(opts: {
  target: PlaybackTarget | null;
  active: boolean;
  live: boolean;
  nativeHls?: boolean;
  fetcher?: PlaybackFetcher;
}) {
  const { target, active, live } = opts;
  const nativeHls = !!opts.nativeHls;
  const fetcher = opts.fetcher || defaultFetcher;
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const [gate, setGate] = useState<PlaybackGate>({ kind: "idle" });
  const [url, setUrl] = useState<string | null>(null);
  const urlRef = useRef<string | null>(null);
  const tokenRef = useRef<string | null>(null);
  const seqRef = useRef(0);

  const targetKey = target ? `${target.kind}:${target.id}` : "";

  const refresh = useCallback(async (): Promise<PlaybackGate> => {
    if (!target || !active) return { kind: "idle" };
    const seq = ++seqRef.current;
    setGate((g) => (g.kind === "granted" ? g : { kind: "pending" }));
    let next: PlaybackGate;
    try {
      const { status, body } = await fetcherRef.current(playbackPath(target));
      next = interpretPlaybackResponse(status, body, API_BASE);
    } catch {
      next = { kind: "unavailable", message: "Playback is temporarily unavailable. Retrying…" };
    }
    if (seq !== seqRef.current) return next; // superseded
    setGate(next);
    if (next.kind === "granted") {
      tokenRef.current = playbackTokenOf(next.url);
      const nu = nextPlayerUrl(urlRef.current, next.url, nativeHls);
      urlRef.current = nu;
      setUrl(nu);
    } else {
      tokenRef.current = null;
      urlRef.current = null;
      setUrl(null);
    }
    return next;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetKey, active, nativeHls]);

  // (Re)ask on target/activation change and when the stream goes live/offline.
  useEffect(() => {
    if (!target || !active) {
      seqRef.current++;
      setGate({ kind: "idle" });
      urlRef.current = null;
      tokenRef.current = null;
      setUrl(null);
      return;
    }
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetKey, active, live]);

  // Renew signed URLs before they expire; retry transient failures.
  useEffect(() => {
    if (!active) return;
    let delay: number | null = null;
    if (gate.kind === "granted") delay = playbackRenewDelayMs(gate.expiresAt, Date.now());
    else if (gate.kind === "unavailable") delay = 10_000;
    if (delay === null) return;
    const t = window.setTimeout(() => void refresh(), delay);
    return () => window.clearTimeout(t);
  }, [gate, active, refresh]);

  return { gate, url: live ? url : null, tokenRef, refresh };
}
