import { useEffect, useMemo, useState } from "react";
import { createEduSavedEmbed } from "../api/savedEmbeds";
import { listEduEventsFromApi, type EduEventListItem } from "../api/events";
import { upsertEduEventEmbed, type EduEventEmbed } from "../api/embeds";
import { apiFetchAuth } from "../../lib/api";

type EmbedSourceType = "event" | "room";
type Placement = "internal" | "public";
type AccessMode = "public" | "unlisted" | "password";
type PreviewState = "scheduled" | "live" | "offair";

type ShareableRoom = {
  id: string;
  name: string;
  description: string;
  roomType: string;
  broadcastEnabled: boolean;
  isLive: boolean;
};

/* ── helpers ────────────────────────────────────────────────────── */

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function formatShort(dtIso: string | null) {
  if (!dtIso) return "";
  const ms = new Date(dtIso).getTime();
  if (!Number.isFinite(ms)) return "";
  try {
    return new Date(ms).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return new Date(ms).toISOString();
  }
}

function statusLabel(raw: string | null) {
  const s = String(raw || "").toLowerCase();
  if (s === "live") return "Live";
  if (s === "ended") return "Ended";
  if (s === "scheduled") return "Scheduled";
  if (s) return s;
  return "Scheduled";
}

async function fetchShareableRooms(): Promise<ShareableRoom[]> {
  const res = await apiFetchAuth("/api/edu/rooms/shareable");
  if (!res.ok) throw new Error("Failed to load shareable rooms");
  const data = await res.json();
  return data.rooms ?? [];
}

/* ── component ──────────────────────────────────────────────────── */

export default function Embed() {
  /* ── source type ─────────────────────────────────────────────── */
  const [sourceType, setSourceType] = useState<EmbedSourceType>("event");
  const [placement, setPlacement] = useState<Placement>("public");
  const [accessMode, setAccessMode] = useState<AccessMode>("public");
  const [previewState, setPreviewState] = useState<PreviewState>("scheduled");

  /* ── event embeds (secure: embedId + token + optional password) */
  const [eventEmbed, setEventEmbed] = useState<EduEventEmbed | null>(null);
  const [eventEmbedLoading, setEventEmbedLoading] = useState(false);
  const [eventEmbedError, setEventEmbedError] = useState<string | null>(null);
  const [passwordDraft, setPasswordDraft] = useState("");
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  /* ── event list ──────────────────────────────────────────────── */
  const [events, setEvents] = useState<EduEventListItem[]>([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [eventsError, setEventsError] = useState<string | null>(null);
  const [selectedEventId, setSelectedEventId] = useState("");

  /* ── shareable rooms ──────────────────────────────────────────── */
  const [shareableRooms, setShareableRooms] = useState<ShareableRoom[]>([]);
  const [roomsLoading, setRoomsLoading] = useState(false);
  const [roomsError, setRoomsError] = useState<string | null>(null);
  const [selectedRoomId, setSelectedRoomId] = useState("");
  const [roomEmbedId, setRoomEmbedId] = useState<string | null>(null);
  const [roomEmbedBusy, setRoomEmbedBusy] = useState(false);
  const [roomEmbedError, setRoomEmbedError] = useState<string | null>(null);

  /* ── load events on mount ────────────────────────────────────── */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setEventsLoading(true);
      setEventsError(null);
      try {
        const list = await listEduEventsFromApi({ limit: 50 });
        if (cancelled) return;
        setEvents(list);
        if (!selectedEventId && list[0]?.id) setSelectedEventId(list[0].id);
      } catch (e: any) {
        if (cancelled) return;
        setEventsError(e?.message || "Failed to load events");
        setEvents([]);
      } finally {
        if (!cancelled) setEventsLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── load shareable rooms on mount ───────────────────────────── */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setRoomsLoading(true);
      setRoomsError(null);
      try {
        const list = await fetchShareableRooms();
        if (cancelled) return;
        setShareableRooms(list);
        if (!selectedRoomId && list[0]?.id) setSelectedRoomId(list[0].id);
      } catch (e: any) {
        if (cancelled) return;
        setRoomsError(e?.message || "Failed to load shareable rooms");
        setShareableRooms([]);
      } finally {
        if (!cancelled) setRoomsLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── create / update secure event embed ─────────────────────── */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (sourceType !== "event") return;
      const eventId = String(selectedEventId || "").trim();
      if (!eventId) return;
      setEventEmbedLoading(true);
      setEventEmbedError(null);
      try {
        const embed = await upsertEduEventEmbed({ eventId, accessMode });
        if (cancelled) return;
        setEventEmbed(embed);
      } catch (e: any) {
        if (cancelled) return;
        setEventEmbed(null);
        setEventEmbedError(e?.message || "Failed to create embed");
      } finally {
        if (!cancelled) setEventEmbedLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [sourceType, selectedEventId, accessMode]);

  /* ── ensure room embed (saved embed for a shareable room) ───── */
  async function ensureRoomEmbed() {
    const room = shareableRooms.find((r) => r.id === selectedRoomId);
    if (!room) return;
    setRoomEmbedBusy(true);
    setRoomEmbedError(null);
    try {
      const embed = await createEduSavedEmbed({
        name: `Live Broadcast – ${room.name}`,
        description: `Public embed for room "${room.name}"`,
        sourceRoomId: room.id,
        hlsConfig: {
          title: room.name,
          subtitle: "Live Broadcast",
          offlineMessage: "Off Air — Check back during broadcast time.",
          enabled: true,
          theme: "dark",
        },
      });
      if (embed?.embedId) {
        setRoomEmbedId(embed.embedId);
      } else {
        setRoomEmbedError("Could not create embed");
      }
    } catch (e: any) {
      setRoomEmbedError(e?.message || "Could not create embed");
    } finally {
      setRoomEmbedBusy(false);
    }
  }

  /* ── derived values ──────────────────────────────────────────── */
  const selectedEvent = useMemo(() => events.find((e) => e.id === selectedEventId) || null, [events, selectedEventId]);
  const selectedRoom = useMemo(() => shareableRooms.find((r) => r.id === selectedRoomId) || null, [shareableRooms, selectedRoomId]);
  const origin = typeof window !== "undefined" ? window.location.origin : "";

  const directUrl = useMemo(() => {
    if (sourceType === "event") {
      if (!eventEmbed?.embedId) return "";
      const u = new URL(`${origin}/streamline/edu/embed/event`);
      u.searchParams.set("embedId", eventEmbed.embedId);
      if (eventEmbed.token) u.searchParams.set("t", eventEmbed.token);
      return u.toString();
    }
    if (sourceType === "room") {
      if (!roomEmbedId) return "";
      return `${origin}/live/${encodeURIComponent(roomEmbedId)}`;
    }
    return "";
  }, [origin, sourceType, eventEmbed?.embedId, eventEmbed?.token, roomEmbedId]);

  const iframeCode = useMemo(() => {
    if (!directUrl) return "";
    return `<iframe src="${directUrl}" style="width:100%;aspect-ratio:16/9;border:0;" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen></iframe>`;
  }, [directUrl]);

  const previewUrl = useMemo(() => {
    if (!directUrl) return "";
    if (sourceType !== "event") return directUrl;
    const u = new URL(directUrl);
    u.searchParams.set("previewState", previewState);
    return u.toString();
  }, [directUrl, previewState, sourceType]);

  /* ── dynamic step numbering (Access Mode only for events) ───── */
  const showAccessStep = sourceType === "event";
  const accessStepNum = showAccessStep ? 3 : null;
  const outputStepNum = showAccessStep ? 4 : 3;
  const previewStepNum = showAccessStep ? 5 : 4;

  /* ── render ──────────────────────────────────────────────────── */
  return (
    <div className="space-y-6">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold text-white">Website Embed</h1>
        <p className="mt-1 text-sm text-slate-400">
          Centralized publishing center — generate viewer links and iframe embed code for Events and Shareable Rooms.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        {/* ── Left column: generator ─────────────────────────── */}
        <div className="flex flex-col gap-6">
          {/* ── Step 1: Embed Source ──────────────────────────── */}
          <div className="rounded-2xl border border-slate-700 bg-gradient-to-br from-slate-800 to-slate-800/50 p-6">
            <div className="text-lg font-semibold text-white">1) Embed Source</div>
            <div className="mt-1 text-sm text-slate-400">Choose the broadcast content you want to embed.</div>

            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              {/* Event card */}
              <button
                type="button"
                onClick={() => setSourceType("event")}
                className={cx(
                  "rounded-xl border p-4 text-left transition-colors",
                  sourceType === "event"
                    ? "border-orange-500/40 bg-orange-500/10"
                    : "border-slate-800/50 bg-slate-900/30 hover:border-slate-700 hover:bg-slate-800/40"
                )}
              >
                <div className="text-sm font-medium text-white">Event / Scheduled Broadcast</div>
                <div className="mt-1 text-xs text-slate-400">Embed a specific event's broadcast player.</div>
              </button>

              {/* Room card */}
              <button
                type="button"
                onClick={() => setSourceType("room")}
                className={cx(
                  "rounded-xl border p-4 text-left transition-colors",
                  sourceType === "room"
                    ? "border-orange-500/40 bg-orange-500/10"
                    : "border-slate-800/50 bg-slate-900/30 hover:border-slate-700 hover:bg-slate-800/40"
                )}
              >
                <div className="text-sm font-medium text-white">Shareable Room</div>
                <div className="mt-1 text-xs text-slate-400">Stable embed — always shows the room's live broadcast or off-air state.</div>
              </button>
            </div>

            {/* ── Source selector (event) ────────────────────── */}
            {sourceType === "event" && (
              <div className="mt-4 space-y-3">
                <label className="text-sm text-slate-300">Select Event</label>
                <select
                  value={selectedEventId}
                  onChange={(e) => setSelectedEventId(e.target.value)}
                  className="w-full rounded-xl border border-slate-700/60 bg-slate-950/40 px-3 py-2 text-sm text-white outline-none focus:border-orange-500/50"
                >
                  {eventsLoading && <option value="">Loading…</option>}
                  {!eventsLoading && events.length === 0 && <option value="">No events found</option>}
                  {events.map((ev) => (
                    <option key={ev.id} value={ev.id}>
                      {ev.title || ev.id}{ev.scheduledStartAt ? ` · ${formatShort(ev.scheduledStartAt)}` : ""}
                    </option>
                  ))}
                </select>

                {eventsError && (
                  <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                    {eventsError}
                  </div>
                )}

                {selectedEvent && (
                  <div className="rounded-xl border border-slate-700/60 bg-slate-950/40 px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-white">{selectedEvent.title || "Untitled"}</div>
                        <div className="mt-1 text-xs text-slate-500">{formatShort(selectedEvent.scheduledStartAt)}</div>
                      </div>
                      <div className="rounded-full border border-slate-700/40 bg-slate-900/60 px-3 py-1 text-xs text-slate-200">
                        {statusLabel(selectedEvent.status)}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ── Source selector (shareable room) ──────────── */}
            {sourceType === "room" && (
              <div className="mt-4 space-y-3">
                <label className="text-sm text-slate-300">Select Shareable Room</label>
                <select
                  value={selectedRoomId}
                  onChange={(e) => { setSelectedRoomId(e.target.value); setRoomEmbedId(null); }}
                  className="w-full rounded-xl border border-slate-700/60 bg-slate-950/40 px-3 py-2 text-sm text-white outline-none focus:border-orange-500/50"
                >
                  {roomsLoading && <option value="">Loading…</option>}
                  {!roomsLoading && shareableRooms.length === 0 && (
                    <option value="">No shareable rooms — mark a room as "shareable externally" in Broadcast Rooms.</option>
                  )}
                  {shareableRooms.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}{r.isLive ? " 🔴 LIVE" : ""}
                    </option>
                  ))}
                </select>

                {roomsError && (
                  <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                    {roomsError}
                  </div>
                )}

                {selectedRoom && (
                  <div className="rounded-xl border border-slate-700/60 bg-slate-950/40 px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-white">{selectedRoom.name}</div>
                        <div className="mt-1 text-xs text-slate-500">{selectedRoom.description || selectedRoom.roomType}</div>
                      </div>
                      {selectedRoom.isLive && (
                        <div className="rounded-full border border-red-500/40 bg-red-500/20 px-3 py-1 text-xs text-red-200">Live</div>
                      )}
                    </div>

                    {!roomEmbedId && (
                      <div className="mt-3 flex items-center justify-between gap-3">
                        <div className="text-xs text-slate-500">Generate a stable embed for this room.</div>
                        <button
                          type="button"
                          disabled={roomEmbedBusy}
                          onClick={() => void ensureRoomEmbed()}
                          className={cx(
                            "rounded-xl px-3 py-2 text-xs font-semibold",
                            roomEmbedBusy
                              ? "cursor-not-allowed bg-slate-800 text-slate-500"
                              : "bg-gradient-to-r from-orange-500 via-red-600 to-violet-600 text-white shadow-sm transition-transform hover:-translate-y-0.5 hover:from-orange-400 hover:via-red-500 hover:to-violet-500"
                          )}
                        >
                          {roomEmbedBusy ? "Creating…" : "Generate Embed"}
                        </button>
                      </div>
                    )}

                    {roomEmbedId && (
                      <div className="mt-3 text-xs text-emerald-400">✓ Embed ready</div>
                    )}

                    {roomEmbedError && (
                      <div className="mt-3 rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                        {roomEmbedError}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── Step 2: Where ────────────────────────────────── */}
          <div className="rounded-2xl border border-slate-700 bg-gradient-to-br from-slate-800 to-slate-800/50 p-6">
            <div className="text-lg font-semibold text-white">2) Where will it be embedded?</div>
            <div className="mt-1 text-sm text-slate-400">Internal vs public (intent).</div>

            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => setPlacement("internal")}
                className={cx(
                  "rounded-xl border px-4 py-3 text-left transition-colors",
                  placement === "internal"
                    ? "border-orange-500/40 bg-orange-500/10"
                    : "border-slate-800/50 bg-slate-900/30 hover:border-slate-700 hover:bg-slate-800/40"
                )}
              >
                <div className="text-sm font-medium text-white">Internal School Portal</div>
                <div className="mt-1 text-xs text-slate-400">Unlisted intent; optional login later.</div>
              </button>

              <button
                type="button"
                onClick={() => setPlacement("public")}
                className={cx(
                  "rounded-xl border px-4 py-3 text-left transition-colors",
                  placement === "public"
                    ? "border-orange-500/40 bg-orange-500/10"
                    : "border-slate-800/50 bg-slate-900/30 hover:border-slate-700 hover:bg-slate-800/40"
                )}
              >
                <div className="text-sm font-medium text-white">Public Website</div>
                <div className="mt-1 text-xs text-slate-400">Public viewing; no login prompts.</div>
              </button>
            </div>
          </div>

          {/* ── Step 3: Access Mode (events only) ─────────────── */}
          {showAccessStep && (
            <div className="rounded-2xl border border-slate-700 bg-gradient-to-br from-slate-800 to-slate-800/50 p-6">
              <div className="text-lg font-semibold text-white">{accessStepNum}) Access Mode</div>
              <div className="mt-1 text-sm text-slate-400">Secure event embeds (token + optional password).</div>

              <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
                <button
                  type="button"
                  onClick={() => setAccessMode("public")}
                  className={cx(
                    "rounded-xl border px-4 py-3 text-left transition-colors",
                    accessMode === "public"
                      ? "border-orange-500/40 bg-orange-500/10"
                      : "border-slate-800/50 bg-slate-900/30 hover:border-slate-700 hover:bg-slate-800/40"
                  )}
                >
                  <div className="text-sm font-medium text-white">Public</div>
                  <div className="mt-1 text-xs text-slate-400">Works anywhere.</div>
                </button>

                <button
                  type="button"
                  onClick={() => setAccessMode("unlisted")}
                  className={cx(
                    "rounded-xl border px-4 py-3 text-left transition-colors",
                    accessMode === "unlisted"
                      ? "border-orange-500/40 bg-orange-500/10"
                      : "border-slate-800/50 bg-slate-900/30 hover:border-slate-700 hover:bg-slate-800/40"
                  )}
                >
                  <div className="text-sm font-medium text-white">Unlisted link</div>
                  <div className="mt-1 text-xs text-slate-400">Not indexed; link-only.</div>
                </button>

                <button
                  type="button"
                  onClick={() => setAccessMode("password")}
                  className={cx(
                    "rounded-xl border px-4 py-3 text-left transition-colors",
                    accessMode === "password"
                      ? "border-orange-500/40 bg-orange-500/10"
                      : "border-slate-800/50 bg-slate-900/30 hover:border-slate-700 hover:bg-slate-800/40"
                  )}
                >
                  <div className="text-sm font-medium text-white">Password</div>
                  <div className="mt-1 text-xs text-slate-400">Prompt viewers; stores grant.</div>
                </button>
              </div>

              {accessMode === "password" && (
                <div className="mt-4 rounded-xl border border-slate-800/60 bg-slate-950/40 p-4">
                  <div className="text-sm font-medium text-white">Set embed password</div>
                  <div className="mt-1 text-xs text-slate-400">Required for viewers. Stored as a hash.</div>

                  <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
                    <div className="flex-1">
                      <label className="text-xs text-slate-400">Password</label>
                      <input
                        type="password"
                        value={passwordDraft}
                        onChange={(e) => setPasswordDraft(e.target.value)}
                        className="mt-2 w-full rounded-xl border border-slate-700/60 bg-slate-950/40 px-3 py-2 text-sm text-white outline-none focus:border-orange-500/40"
                        placeholder="Enter a password"
                      />
                    </div>

                    <button
                      type="button"
                      disabled={passwordBusy || !selectedEventId || passwordDraft.trim().length < 4}
                      onClick={async () => {
                        setPasswordBusy(true);
                        setPasswordError(null);
                        try {
                          const embed = await upsertEduEventEmbed({
                            eventId: selectedEventId,
                            accessMode: "password",
                            password: passwordDraft,
                          });
                          setEventEmbed(embed);
                        } catch (e: any) {
                          setPasswordError(e?.message || "Failed to set password");
                        } finally {
                          setPasswordBusy(false);
                        }
                      }}
                      className={cx(
                        "rounded-xl px-4 py-2 text-sm font-semibold",
                        passwordBusy || passwordDraft.trim().length < 4
                          ? "cursor-not-allowed bg-slate-800 text-slate-500"
                          : "bg-gradient-to-r from-orange-500 via-red-600 to-violet-600 text-white shadow-sm transition-transform hover:-translate-y-0.5 hover:from-orange-400 hover:via-red-500 hover:to-violet-500"
                      )}
                    >
                      {passwordBusy ? "Saving…" : "Set password"}
                    </button>
                  </div>

                  {!eventEmbed?.hasPassword && (
                    <div className="mt-3 rounded-xl border border-orange-500/20 bg-orange-500/10 px-3 py-2 text-xs text-orange-100">
                      Password mode is selected, but a password hasn't been set yet.
                    </div>
                  )}

                  {passwordError && (
                    <div className="mt-3 rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-200">
                      {passwordError}
                    </div>
                  )}
                </div>
              )}

              <div className="mt-3 text-xs text-slate-500">
                Event embeds are enforced server-side using <span className="text-slate-200">embedId + token</span> (and password when enabled).
                {placement === "public" ? " Public Website embeds should typically use Public." : ""}
              </div>
            </div>
          )}

          {/* ── Step N: Embed Output ─────────────────────────── */}
          <div className="rounded-2xl border border-slate-700 bg-gradient-to-br from-slate-800 to-slate-800/50 p-6">
            <div className="text-lg font-semibold text-white">{outputStepNum}) Embed Output</div>
            <div className="mt-1 text-sm text-slate-400">Iframe + direct link.</div>

            {!directUrl ? (
              <div className="mt-4 rounded-xl border border-slate-700/60 bg-slate-950/40 px-4 py-3 text-sm text-slate-300">
                {sourceType === "event" && eventEmbedLoading
                  ? "Generating secure embed…"
                  : sourceType === "room" && !roomEmbedId
                    ? "Select a shareable room and click Generate Embed."
                    : "Select an embed source to generate output."}
              </div>
            ) : (
              <div className="mt-4 space-y-4">
                <div>
                  <div className="text-sm font-medium text-white">✅ Iframe embed (recommended)</div>
                  <textarea
                    readOnly
                    value={iframeCode}
                    className="mt-2 h-24 w-full rounded-xl border border-slate-700/60 bg-slate-950/40 px-3 py-2 text-xs text-slate-100 outline-none"
                  />
                </div>

                <div>
                  <div className="text-sm font-medium text-white">✅ Direct link (backup)</div>
                  <input
                    readOnly
                    value={directUrl}
                    className="mt-2 w-full rounded-xl border border-slate-700/60 bg-slate-950/40 px-3 py-2 text-xs text-slate-100 outline-none"
                  />
                </div>

                {sourceType === "event" && (
                  <div className="rounded-xl border border-slate-700/60 bg-slate-950/40 px-4 py-3 text-xs text-slate-400">
                    Event embeds point to a stable player page: <span className="text-slate-200">/streamline/edu/embed/event?embedId=…&amp;t=…</span>
                  </div>
                )}

                {sourceType === "room" && (
                  <div className="rounded-xl border border-slate-700/60 bg-slate-950/40 px-4 py-3 text-xs text-slate-400">
                    Room embeds point to a stable live page: <span className="text-slate-200">/live/…</span> — always shows the room's current broadcast state.
                  </div>
                )}

                {sourceType === "event" && eventEmbedError && (
                  <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-xs text-red-200">
                    {eventEmbedError}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── How it works info ────────────────────────────── */}
          <div className="rounded-2xl border border-slate-700/40 bg-slate-900/30 p-5">
            <div className="text-sm font-medium text-slate-300">How it works</div>
            <ol className="mt-2 list-inside list-decimal space-y-1 text-xs text-slate-500">
              <li><span className="text-slate-300">Broadcast Studio</span> — production source (crew operates the broadcast).</li>
              <li><span className="text-slate-300">Website Embed</span> (this page) — centralized publishing center for all viewer links &amp; embed code.</li>
              <li><span className="text-slate-300">Events</span> — scheduled broadcasts linked to a room; generally external-facing.</li>
              <li><span className="text-slate-300">Rooms with "Shareable Externally"</span> — stable room-level embeds (e.g. Morning Announcements).</li>
            </ol>
          </div>
        </div>

        {/* ── Right column: preview ──────────────────────────── */}
        <div className="rounded-2xl border border-slate-700 bg-gradient-to-br from-slate-800 to-slate-800/50 p-6">
          <div>
            <div className="text-lg font-semibold text-white">{previewStepNum}) Preview</div>
            <div className="mt-1 text-sm text-slate-400">Preview the exact player page the iframe will show.</div>
          </div>

          {sourceType === "event" && (
            <div className="mt-4 grid grid-cols-3 gap-2">
              {([
                { id: "scheduled" as const, label: "Scheduled" },
                { id: "live" as const, label: "Live" },
                { id: "offair" as const, label: "Off-air" },
              ] as const).map((x) => (
                <button
                  key={x.id}
                  type="button"
                  onClick={() => setPreviewState(x.id)}
                  className={cx(
                    "rounded-xl border px-3 py-2 text-sm transition-colors",
                    previewState === x.id
                      ? "border-orange-500/40 bg-orange-500/10 text-white"
                      : "border-slate-800/50 bg-slate-900/30 text-slate-300 hover:border-slate-700 hover:bg-slate-800/40"
                  )}
                >
                  {x.label}
                </button>
              ))}
            </div>
          )}

          {!previewUrl ? (
            <div className="mt-4 rounded-xl border border-slate-800/60 bg-slate-950/40 px-4 py-3 text-sm text-slate-300">
              Generate an embed to preview it.
            </div>
          ) : (
            <div className="mt-4 overflow-hidden rounded-2xl border border-slate-800/60 bg-black">
              <iframe
                title="Embed preview"
                src={previewUrl}
                className="aspect-video w-full"
                style={{ border: 0 }}
                allow="autoplay; fullscreen; picture-in-picture"
                allowFullScreen
              />
            </div>
          )}

          <div className="mt-4 rounded-xl border border-slate-800/60 bg-slate-950/40 px-4 py-3 text-xs text-slate-500">
            Source: <span className="text-slate-200">{sourceType === "event" ? "Event" : "Shareable Room"}</span> ·
            Placement: <span className="text-slate-200">{placement === "internal" ? "Internal School Portal" : "Public Website"}</span>
            {showAccessStep && (
              <> · Access: <span className="text-slate-200">{accessMode === "public" ? "Public" : accessMode === "unlisted" ? "Unlisted link" : "Password"}</span></>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
