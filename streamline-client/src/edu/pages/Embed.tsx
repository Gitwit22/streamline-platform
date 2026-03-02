import { useEffect, useMemo, useState } from "react";
import { createEduSavedEmbed } from "../api/savedEmbeds";
import { listEduEventsFromApi, type EduEventListItem } from "../api/events";
import { upsertEduEventEmbed, type EduEventEmbed } from "../api/embeds";

type EmbedTarget = "event" | "channel" | "recording";
type Placement = "internal" | "public";
type AccessMode = "public" | "unlisted" | "password";
type PreviewState = "scheduled" | "live" | "offair";

const SCHOOL_NETWORK_EMBED_KEY = "sl_edu_school_network_embed_id_v1";

function classNames(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function loadSchoolNetworkEmbedId(): string | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage.getItem(SCHOOL_NETWORK_EMBED_KEY) || null;
  } catch {
    return null;
  }
}

function persistSchoolNetworkEmbedId(embedId: string) {
  try {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(SCHOOL_NETWORK_EMBED_KEY, embedId);
  } catch {
    // ignore
  }
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

export default function Embed() {
  const [target, setTarget] = useState<EmbedTarget>("event");
  const [placement, setPlacement] = useState<Placement>("internal");
  const [accessMode, setAccessMode] = useState<AccessMode>("public");
  const [previewState, setPreviewState] = useState<PreviewState>("scheduled");

  // Event embeds (secure: embedId + token + optional password)
  const [eventEmbed, setEventEmbed] = useState<EduEventEmbed | null>(null);
  const [eventEmbedLoading, setEventEmbedLoading] = useState(false);
  const [eventEmbedError, setEventEmbedError] = useState<string | null>(null);
  const [passwordDraft, setPasswordDraft] = useState<string>("");
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  // Channel (current live) embed id
  const [channelEmbedId, setChannelEmbedId] = useState<string | null>(() => loadSchoolNetworkEmbedId());
  const [channelBusy, setChannelBusy] = useState(false);
  const [channelError, setChannelError] = useState<string | null>(null);

  // Event list
  const [events, setEvents] = useState<EduEventListItem[]>([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [eventsError, setEventsError] = useState<string | null>(null);
  const [selectedEventId, setSelectedEventId] = useState<string>("");

  // Create/update secure embed doc for selected event.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (target !== "event") return;
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

    return () => {
      cancelled = true;
    };
  }, [target, selectedEventId, accessMode]);

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

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedEvent = useMemo(() => events.find((e) => e.id === selectedEventId) || null, [events, selectedEventId]);

  const origin = typeof window !== "undefined" ? window.location.origin : "";

  const channelViewerUrl = useMemo(() => {
    if (!channelEmbedId) return "";
    return `${origin}/live/${encodeURIComponent(channelEmbedId)}`;
  }, [origin, channelEmbedId]);

  async function ensureChannelEmbed() {
    if (channelEmbedId) return;
    setChannelBusy(true);
    setChannelError(null);
    try {
      const embed = await createEduSavedEmbed({
        name: "School Network (Current Live)",
        description: "Stable embed for Morning Announcements / Current Live",
        hlsConfig: {
          title: "Current Live",
          subtitle: "School Network",
          offlineMessage: "Off Air",
          enabled: true,
          theme: "dark",
        },
      });

      if (embed?.embedId) {
        persistSchoolNetworkEmbedId(embed.embedId);
        setChannelEmbedId(embed.embedId);
      } else {
        setChannelError("Could not create embed");
      }
    } catch (e: any) {
      setChannelError(e?.message || "Could not create embed (check HLS setup / permissions)");
    } finally {
      setChannelBusy(false);
    }
  }

  const directUrl = useMemo(() => {
    if (target === "event") {
      if (!eventEmbed?.embedId) return "";
      const u = new URL(`${origin}/streamline/edu/embed/event`);
      u.searchParams.set("embedId", eventEmbed.embedId);
      if (eventEmbed.token) u.searchParams.set("t", eventEmbed.token);
      return u.toString();
    }
    if (target === "channel") {
      return channelViewerUrl;
    }
    // Phase 2
    return "";
  }, [origin, target, eventEmbed?.embedId, eventEmbed?.token, channelViewerUrl]);

  const iframeCode = useMemo(() => {
    if (!directUrl) return "";
    return `<iframe src="${directUrl}" style="width:100%;aspect-ratio:16/9;border:0;" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen></iframe>`;
  }, [directUrl]);

  const previewUrl = useMemo(() => {
    if (!directUrl) return "";
    if (target !== "event") return directUrl;
    const u = new URL(directUrl);
    u.searchParams.set("previewState", previewState);
    return u.toString();
  }, [directUrl, previewState, target]);

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
      {/* Left: generator */}
      <div className="flex flex-col gap-6">
        <div className="rounded-2xl border border-slate-700 bg-gradient-to-br from-slate-800 to-slate-800/50 p-6">
          <div className="text-lg font-semibold text-white">1) Embed Target</div>
          <div className="mt-1 text-sm text-slate-400">Choose what the embed should show.</div>

          <div className="mt-4 space-y-3">
            {/* A) Event */}
            <button
              type="button"
              onClick={() => setTarget("event")}
              className={classNames(
                "w-full rounded-xl border p-4 text-left transition-colors",
                target === "event"
                  ? "border-orange-500/40 bg-orange-500/10"
                  : "border-slate-800/50 bg-slate-900/30 hover:border-slate-700 hover:bg-slate-800/40"
              )}
            >
              <div className="font-medium text-white">A) Event / Scheduled Broadcast</div>
              <div className="mt-1 text-sm text-slate-400">Generates embed for that event’s broadcast player.</div>

              {target === "event" ? (
                <div className="mt-4 grid grid-cols-1 gap-3">
                  <label className="text-sm text-slate-300">Select Event</label>
                  <select
                    value={selectedEventId}
                    onChange={(e) => setSelectedEventId(e.target.value)}
                    className="w-full rounded-xl border border-slate-700/60 bg-slate-950/40 px-3 py-2 text-sm text-white outline-none focus:border-orange-500/50"
                  >
                    {eventsLoading ? <option value="">Loading…</option> : null}
                    {!eventsLoading && events.length === 0 ? <option value="">No events found</option> : null}
                    {events.map((ev) => (
                      <option key={ev.id} value={ev.id}>
                        {ev.title || ev.id}{ev.scheduledStartAt ? ` · ${formatShort(ev.scheduledStartAt)}` : ""}
                      </option>
                    ))}
                  </select>

                  {eventsError ? (
                    <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                      {eventsError}
                    </div>
                  ) : null}

                  {selectedEvent ? (
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
                  ) : null}
                </div>
              ) : null}
            </button>

            {/* B) Channel */}
            <button
              type="button"
              onClick={() => setTarget("channel")}
              className={classNames(
                "w-full rounded-xl border p-4 text-left transition-colors",
                target === "channel"
                  ? "border-orange-500/40 bg-orange-500/10"
                  : "border-slate-800/50 bg-slate-900/30 hover:border-slate-700 hover:bg-slate-800/40"
              )}
            >
              <div className="font-medium text-white">B) Current Live Channel (Optional)</div>
              <div className="mt-1 text-sm text-slate-400">“Morning Announcements / School Network” (always the same embed).</div>

              {target === "channel" ? (
                <div className="mt-4">
                  {!channelEmbedId ? (
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-xs text-slate-500">Not set up yet.</div>
                      <button
                        type="button"
                        disabled={channelBusy}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          void ensureChannelEmbed();
                        }}
                        className={classNames(
                          "rounded-xl px-3 py-2 text-xs font-semibold",
                          channelBusy
                            ? "cursor-not-allowed bg-slate-800 text-slate-500"
                            : "bg-gradient-to-r from-orange-500 via-red-600 to-violet-600 text-white shadow-sm transition-transform hover:-translate-y-0.5 hover:from-orange-400 hover:via-red-500 hover:to-violet-500"
                        )}
                      >
                        Create Channel Embed
                      </button>
                    </div>
                  ) : (
                    <div className="text-xs text-slate-500">Ready.</div>
                  )}

                  {channelError ? (
                    <div className="mt-3 rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                      {channelError}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </button>

            {/* C) Recording */}
            <div className="w-full rounded-xl border border-slate-800/50 bg-slate-900/20 p-4 opacity-70">
              <div className="font-medium text-white">C) Recording / Replay (Optional, Phase 2)</div>
              <div className="mt-1 text-sm text-slate-400">Embed a recorded performance for on-demand viewing.</div>
              <div className="mt-2 text-xs text-slate-500">Coming in Phase 2.</div>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-700 bg-gradient-to-br from-slate-800 to-slate-800/50 p-6">
          <div className="text-lg font-semibold text-white">2) Where will it be embedded?</div>
          <div className="mt-1 text-sm text-slate-400">Internal vs public (intent).</div>

          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => setPlacement("internal")}
              className={classNames(
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
              className={classNames(
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

        <div className="rounded-2xl border border-slate-700 bg-gradient-to-br from-slate-800 to-slate-800/50 p-6">
          <div className="text-lg font-semibold text-white">3) Access Mode</div>
          <div className="mt-1 text-sm text-slate-400">Secure event embeds (token + optional password).</div>

          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <button
              type="button"
              onClick={() => setAccessMode("public")}
              className={classNames(
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
              className={classNames(
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
              className={classNames(
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

          {target === "event" && accessMode === "password" ? (
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
                  className={classNames(
                    "rounded-xl px-4 py-2 text-sm font-semibold",
                    passwordBusy || passwordDraft.trim().length < 4
                      ? "cursor-not-allowed bg-slate-800 text-slate-500"
                      : "bg-gradient-to-r from-orange-500 via-red-600 to-violet-600 text-white shadow-sm transition-transform hover:-translate-y-0.5 hover:from-orange-400 hover:via-red-500 hover:to-violet-500"
                  )}
                >
                  {passwordBusy ? "Saving…" : "Set password"}
                </button>
              </div>

              {!eventEmbed?.hasPassword ? (
                <div className="mt-3 rounded-xl border border-orange-500/20 bg-orange-500/10 px-3 py-2 text-xs text-orange-100">
                  Password mode is selected, but a password hasn’t been set yet.
                </div>
              ) : null}

              {passwordError ? (
                <div className="mt-3 rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-200">
                  {passwordError}
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="mt-3 text-xs text-slate-500">
            MVP note: event embeds are enforced server-side using <span className="text-slate-200">embedId + token</span> (and password when enabled).
            {placement === "public" ? " Public Website embeds should typically use Public." : ""}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-700 bg-gradient-to-br from-slate-800 to-slate-800/50 p-6">
          <div className="text-lg font-semibold text-white">4) Embed Output</div>
          <div className="mt-1 text-sm text-slate-400">Iframe + direct link.</div>

          {!directUrl ? (
            <div className="mt-4 rounded-xl border border-slate-700/60 bg-slate-950/40 px-4 py-3 text-sm text-slate-300">
              {target === "event" && eventEmbedLoading ? "Generating secure embed…" : "Select an embed target to generate output."}
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

              {target === "event" ? (
                <div className="rounded-xl border border-slate-700/60 bg-slate-950/40 px-4 py-3 text-xs text-slate-400">
                  Event embeds point to a stable player page: <span className="text-slate-200">/streamline/edu/embed/event?embedId=…&amp;t=…</span>
                </div>
              ) : null}

              {target === "event" && eventEmbedError ? (
                <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-xs text-red-200">
                  {eventEmbedError}
                </div>
              ) : null}
            </div>
          )}
        </div>
      </div>

      {/* Right: preview */}
      <div className="rounded-2xl border border-slate-700 bg-gradient-to-br from-slate-800 to-slate-800/50 p-6">
        <div>
          <div className="text-lg font-semibold text-white">5) Preview</div>
          <div className="mt-1 text-sm text-slate-400">Preview the exact player page the iframe will show.</div>
        </div>

        {target === "event" ? (
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
                className={classNames(
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
        ) : null}

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
          Placement: <span className="text-slate-200">{placement === "internal" ? "Internal School Portal" : "Public Website"}</span> ·
          Access Mode: <span className="text-slate-200">{accessMode === "public" ? "Public" : accessMode === "unlisted" ? "Unlisted link" : "Password"}</span>
        </div>
      </div>
    </div>
  );
}
