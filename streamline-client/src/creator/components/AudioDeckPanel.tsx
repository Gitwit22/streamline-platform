import { useEffect, useRef, useState, type CSSProperties, type DragEvent } from "react";
import { useAudioDeck } from "../hooks/useAudioDeck";
import { useVideoDeck } from "../hooks/useVideoDeck";
import { DECK_LIMITS, isAudioFile, type DeckItem, type DeckList, type LoopMode } from "../../lib/audioDeck";
import { PLAY_MODES, VIDEO_LIMITS, isVideoFile, type PlayMode, type PlayTarget, type VideoItem } from "../../lib/mediaVideo";
import type { PlayerLinkStatus } from "../../lib/youtubePlayerLink";
import { assetsApi, type MediaAsset } from "../../lib/editingApi";
import { getMixer } from "../../lib/mixerInstance";

function fmt(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function droppedAudio(e: DragEvent): File[] {
  return Array.from(e.dataTransfer?.files || []).filter(isAudioFile);
}

function useBroadcasting(): boolean {
  const mixer = getMixer();
  const [on, setOn] = useState(() => mixer.isBroadcasting());
  useEffect(() => mixer.subscribeBroadcast(setOn), [mixer]);
  return on;
}

/**
 * In-room Media panel: stage videos (lib/mediaVideo.ts), background-music
 * playlist and soundboard pads (lib/audioDeck.ts). Audio plays into the
 * mixer's Music channel; videos play on stage as the host's screen share.
 * Files are saved to the content library so they're there next session.
 */
export default function AudioDeckPanel({
  open,
  onClose,
  onOpenMixer,
}: {
  open: boolean;
  onClose: () => void;
  onOpenMixer?: () => void;
}) {
  const { deck, state } = useAudioDeck();
  const broadcasting = useBroadcasting();
  const [picker, setPicker] = useState<DeckList | null>(null);
  const [dropOver, setDropOver] = useState<DeckList | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const playlistInput = useRef<HTMLInputElement>(null);
  const padsInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) void deck.ensureLoaded();
  }, [open, deck]);

  if (!open) return null;

  const add = (files: File[], list: DeckList) => {
    const room = DECK_LIMITS[list] - state[list].length;
    const n = deck.addFiles(files, list);
    if (files.length > 0 && n === 0) {
      setNotice(room <= 0 ? `The ${list === "playlist" ? "playlist" : "soundboard"} is full.` : "Only audio files can be added.");
    } else if (n < files.length) {
      setNotice(`Added ${n} of ${files.length} files (audio only, up to ${DECK_LIMITS[list]}).`);
    } else {
      setNotice(null);
    }
  };

  const dropZone = (list: DeckList) => ({
    onDragOver: (e: DragEvent) => {
      if (!Array.from(e.dataTransfer?.types || []).includes("Files")) return;
      e.preventDefault();
      e.stopPropagation();
      setDropOver(list);
    },
    onDragLeave: () => setDropOver((cur) => (cur === list ? null : cur)),
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDropOver(null);
      add(Array.from(e.dataTransfer?.files || []), list);
    },
  });

  const current = state.playlist.find((x) => x.id === state.currentId) || null;

  return (
    <div data-testid="audio-deck" style={panel}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontWeight: 800, color: "#e5e7eb", fontSize: 14 }}>🎞️ Media</div>
        <button type="button" onClick={onClose} style={iconBtn} aria-label="Close media">
          ✕
        </button>
      </div>

      {!broadcasting && (
        <div style={hintBox} data-testid="audio-not-broadcasting">
          Only you hear this music right now. Turn on <b>Send mix to stream</b> in the mixer so guests and viewers hear the
          playlist and soundboard (video sound is always sent).
          {onOpenMixer && (
            <button type="button" style={{ ...smallBtn, marginLeft: 6 }} onClick={onOpenMixer}>
              Open mixer
            </button>
          )}
        </div>
      )}
      {state.persistError && <div style={warnBox}>{state.persistError}</div>}
      {state.error && (
        <div style={errBox} role="alert">
          {state.error}
          <button type="button" style={{ ...iconBtn, marginLeft: 6 }} aria-label="Dismiss" onClick={() => deck.clearError()}>
            ✕
          </button>
        </div>
      )}
      {notice && <div style={warnBox}>{notice}</div>}
      {!state.loaded && <div style={muted}>Loading your audio…</div>}

      <VideoSection onNotice={setNotice} />

      {/* ---- Now playing ---- */}
      <section style={section}>
        <div style={sectionTitle}>Playlist</div>
        <div style={{ ...ellipsis, fontSize: 12, color: current ? "#f1f5f9" : "#64748b" }} data-testid="now-playing">
          {current ? current.name : "Nothing playing"}
        </div>
        <input
          type="range"
          aria-label="Seek"
          min={0}
          max={Math.max(1, state.duration)}
          step={0.5}
          value={Math.min(state.position, state.duration || 0)}
          disabled={!current || !state.duration}
          onChange={(e) => deck.seek(Number(e.target.value))}
          style={{ width: "100%" }}
        />
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#64748b" }}>
          <span>{fmt(state.position)}</span>
          <span>{fmt(state.duration)}</span>
        </div>
        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
          <button type="button" style={ctrlBtn} aria-label="Previous" onClick={() => deck.previous()} disabled={state.playlist.length === 0}>
            ⏮
          </button>
          <button
            type="button"
            style={{ ...ctrlBtn, background: state.playing ? "#eab308" : "#059669", color: state.playing ? "#000" : "#fff" }}
            aria-label={state.playing ? "Pause" : "Play"}
            onClick={() => deck.togglePlay()}
            disabled={state.playlist.length === 0}
          >
            {state.playing ? "⏸" : "▶"}
          </button>
          <button type="button" style={ctrlBtn} aria-label="Next" onClick={() => deck.next()} disabled={state.playlist.length === 0}>
            ⏭
          </button>
          <button type="button" style={ctrlBtn} aria-label="Stop" onClick={() => deck.stop()} disabled={!current}>
            ⏹
          </button>
          <select
            aria-label="Loop"
            value={state.loopMode}
            onChange={(e) => deck.setLoopMode(e.target.value as LoopMode)}
            style={{ ...select, marginLeft: "auto" }}
          >
            <option value="all">Loop all</option>
            <option value="one">Loop one</option>
            <option value="off">No loop</option>
          </select>
        </div>

        <div {...dropZone("playlist")} style={dropBox(dropOver === "playlist")} data-testid="playlist-drop">
          {state.playlist.length === 0 && <div style={muted}>Drop audio files here, or add them below.</div>}
          {state.playlist.map((it, i) => (
            <ItemRow
              key={it.id}
              item={it}
              active={it.id === state.currentId}
              onPlay={() => deck.playTrack(it.id)}
              onVolume={(v) => deck.setVolume(it.id, v)}
              onUp={i > 0 ? () => deck.move(it.id, -1) : undefined}
              onDown={i < state.playlist.length - 1 ? () => deck.move(it.id, 1) : undefined}
              onRemove={() => deck.remove(it.id)}
              onRetry={() => deck.retrySave(it.id)}
            />
          ))}
        </div>
        <AddButtons
          onFiles={() => playlistInput.current?.click()}
          onLibrary={() => setPicker("playlist")}
          full={state.playlist.length >= DECK_LIMITS.playlist}
        />
        <input
          ref={playlistInput}
          type="file"
          multiple
          accept="audio/*"
          hidden
          data-testid="playlist-file-input"
          onChange={(e) => {
            add(Array.from(e.target.files || []), "playlist");
            e.target.value = "";
          }}
        />
      </section>

      {/* ---- Soundboard ---- */}
      <section style={section}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={sectionTitle}>Soundboard</div>
          <button type="button" style={smallBtn} onClick={() => deck.stopAllPads()} disabled={state.padsPlaying.length === 0}>
            Stop all
          </button>
        </div>
        <div {...dropZone("pads")} style={{ ...dropBox(dropOver === "pads"), display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }} data-testid="pads-drop">
          {state.pads.length === 0 && <div style={{ ...muted, gridColumn: "1 / -1" }}>Drop short sounds here: intros, applause, stingers.</div>}
          {state.pads.map((pad) => (
            <Pad
              key={pad.id}
              pad={pad}
              playing={state.padsPlaying.includes(pad.id)}
              onPlay={() => void deck.playPad(pad.id)}
              onStop={() => deck.stopPad(pad.id)}
              onVolume={(v) => deck.setVolume(pad.id, v)}
              onRemove={() => deck.remove(pad.id)}
              onRetry={() => deck.retrySave(pad.id)}
            />
          ))}
        </div>
        <AddButtons onFiles={() => padsInput.current?.click()} onLibrary={() => setPicker("pads")} full={state.pads.length >= DECK_LIMITS.pads} />
        <input
          ref={padsInput}
          type="file"
          multiple
          accept="audio/*"
          hidden
          data-testid="pads-file-input"
          onChange={(e) => {
            add(Array.from(e.target.files || []), "pads");
            e.target.value = "";
          }}
        />
      </section>

      <div style={{ fontSize: 10, color: "#64748b" }}>
        Music and pads play through the mixer's Music channel. Added files are saved to your content library.
      </div>

      {picker && (
        <LibraryPicker
          kind="audio"
          onClose={() => setPicker(null)}
          onPick={(a) => {
            if (!deck.addFromLibrary({ id: a.id, name: a.name, url: a.videoUrl }, picker)) {
              setNotice(`The ${picker === "playlist" ? "playlist" : "soundboard"} is full.`);
            }
          }}
        />
      )}
    </div>
  );
}

function StagePreview({ stream }: { stream: MediaStream | null }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.srcObject = stream;
    if (stream) void el.play().catch(() => {});
  }, [stream]);
  return (
    <video
      ref={ref}
      muted
      playsInline
      autoPlay
      data-testid="video-preview"
      style={{ width: "100%", aspectRatio: "16 / 9", background: "#000", borderRadius: 6, objectFit: "contain" }}
    />
  );
}

const PLAY_MODE_LABELS: Record<PlayMode, string> = {
  once: "Play one, then stop",
  loop: "Repeat the video",
  next: "Play the playlist in order",
  nextLoop: "Play the playlist on repeat",
};

/** YouTube links play from the StreamLine Media Player tab, captured once per show. */
function YouTubePlayerControls({ status, onOpen, onCapture, onDisconnect }: {
  status: PlayerLinkStatus;
  onOpen: () => void;
  onCapture: () => void;
  onDisconnect: () => void;
}) {
  if (status === "connected") {
    return (
      <div style={{ ...row, justifyContent: "space-between" }} data-testid="yt-player-connected">
        <span style={{ fontSize: 11, color: "#86efac" }}>● YouTube player connected</span>
        <button type="button" style={smallBtn} onClick={onDisconnect}>
          Disconnect
        </button>
      </div>
    );
  }
  return (
    <div style={{ ...hintBox, display: "grid", gap: 6 }} data-testid="yt-player-setup">
      <div>
        <b>YouTube player</b> (once per show, Chrome or Edge):
        <br />
        1. Open the player tab and click <b>Start the player</b> there.
        <br />
        2. Come back and capture it: pick <b>StreamLine Media Player</b> and keep <b>tab audio</b> on.
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        <button type="button" style={smallBtn} onClick={onOpen}>
          {status === "none" ? "1. Open player tab" : "Open player tab again"}
        </button>
        <button type="button" style={{ ...smallBtn, color: status === "ready" ? "#fff" : undefined, background: status === "ready" ? "#2563eb" : undefined }} onClick={onCapture} disabled={status === "none"}>
          2. Capture player tab
        </button>
      </div>
    </div>
  );
}

/**
 * Video playlist: files, library videos and YouTube links, played in the
 * host's own video box or on stage (MediaVideoBridge / lib/mediaOutputs.ts).
 */
function VideoSection({ onNotice }: { onNotice: (msg: string | null) => void }) {
  const { deck, state } = useVideoDeck();
  const [picker, setPicker] = useState(false);
  const [dropOver, setDropOver] = useState(false);
  const [ytInput, setYtInput] = useState("");
  const [ytError, setYtError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void deck.ensureLoaded();
  }, [deck]);

  const add = (files: File[]) => {
    const room = VIDEO_LIMITS.videos - state.videos.length;
    const n = deck.addFiles(files);
    if (files.length > 0 && n === 0) {
      onNotice(room <= 0 ? "The video playlist is full." : "Only video files can be added.");
    } else if (n < files.length) {
      onNotice(`Added ${n} of ${files.length} files (video only, up to ${VIDEO_LIMITS.videos}).`);
    } else {
      onNotice(null);
    }
  };

  const addYouTube = () => {
    const err = deck.addYouTube(ytInput);
    setYtError(err);
    if (!err) setYtInput("");
  };

  const current = state.videos.find((x) => x.id === state.currentId) || null;
  const starting = state.status === "starting";
  const cantPublish = state.attached && !state.caps.box && !state.caps.stage;
  const hasYouTube = state.videos.some((v) => v.kind === "youtube");

  return (
    <section style={section} data-testid="video-section">
      <div style={sectionTitle}>Videos</div>
      <div style={muted}>
        <b>Box</b> plays in your own video tile (your camera comes back after). <b>Stage</b> plays it on stage as a share.
      </div>
      {state.persistError && <div style={warnBox}>{state.persistError}</div>}
      {state.error && (
        <div style={errBox} role="alert" data-testid="video-error">
          {state.error}
          <button type="button" style={{ ...iconBtn, marginLeft: 6 }} aria-label="Dismiss video error" onClick={() => deck.clearError()}>
            ✕
          </button>
        </div>
      )}
      {!state.attached && <div style={warnBox}>Join the room to play videos.</div>}
      {cantPublish && (
        <div style={warnBox} data-testid="video-cant-publish">
          You can't send video from this room. Invisible hosts and audience members can't publish; join as a visible host to play videos.
        </div>
      )}

      {state.status !== "off" && (
        <div data-testid="video-now-playing" style={{ ...pickerBox, borderColor: "rgba(239,68,68,0.6)" }}>
          {state.status === "live" && <StagePreview stream={state.preview} />}
          <div style={{ ...ellipsis, fontSize: 12, color: "#fecaca", fontWeight: 700 }}>
            {starting ? "Starting… " : state.target === "box" ? "● In your video box: " : "● On stage: "}
            {current?.name || ""}
          </div>
          {state.notice && <div style={warnBox}>{state.notice}</div>}
          <input
            type="range"
            aria-label="Seek video"
            min={0}
            max={Math.max(1, state.duration)}
            step={0.5}
            value={Math.min(state.position, state.duration || 0)}
            disabled={starting || !state.duration}
            onChange={(e) => deck.seek(Number(e.target.value))}
            style={{ width: "100%" }}
          />
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#64748b" }}>
            <span>{fmt(state.position)}</span>
            <span>{fmt(state.duration)}</span>
          </div>
          <div style={{ display: "flex", gap: 4 }}>
            <button
              type="button"
              style={{ ...ctrlBtn, background: state.playing ? "#eab308" : "#059669", color: state.playing ? "#000" : "#fff" }}
              aria-label={state.playing ? "Pause video" : "Resume video"}
              onClick={() => deck.togglePause()}
              disabled={starting}
            >
              {state.playing ? "⏸" : "▶"}
            </button>
            <button type="button" style={{ ...smallBtn, color: "#fca5a5", borderColor: "rgba(239,68,68,0.5)" }} onClick={() => void deck.stop()}>
              {state.target === "box" ? "Stop (back to my camera)" : "Stop (off stage)"}
            </button>
          </div>
          {state.target === "box" && <div style={muted}>Turning your camera off also stops the video.</div>}
        </div>
      )}

      <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 11, color: "#cbd5e1" }}>
        Playlist
        <select
          aria-label="Play mode"
          value={state.playMode}
          onChange={(e) => deck.setPlayMode(e.target.value as PlayMode)}
          style={{ ...select, flex: 1 }}
        >
          {PLAY_MODES.map((m) => (
            <option key={m} value={m}>
              {PLAY_MODE_LABELS[m]}
            </option>
          ))}
        </select>
      </label>

      <div
        data-testid="videos-drop"
        style={dropBox(dropOver)}
        onDragOver={(e) => {
          if (!Array.from(e.dataTransfer?.types || []).includes("Files")) return;
          e.preventDefault();
          e.stopPropagation();
          setDropOver(true);
        }}
        onDragLeave={() => setDropOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setDropOver(false);
          add(Array.from(e.dataTransfer?.files || []));
        }}
      >
        {!state.loaded && <div style={muted}>Loading your videos…</div>}
        {state.loaded && state.videos.length === 0 && <div style={muted}>Drop video files here, or add files or YouTube links below.</div>}
        {state.videos.map((it, i) => (
          <VideoRow
            key={it.id}
            item={it}
            playingIn={it.id === state.currentId && state.status !== "off" ? state.target : null}
            canBox={state.attached && state.caps.box && !starting}
            canStage={state.attached && state.caps.stage && !starting}
            needsPlayer={it.kind === "youtube" && state.player !== "connected"}
            onPlay={(target) => void deck.play(it.id, target)}
            onVolume={(v) => deck.setVolume(it.id, v)}
            onUp={i > 0 ? () => deck.move(it.id, -1) : undefined}
            onDown={i < state.videos.length - 1 ? () => deck.move(it.id, 1) : undefined}
            onRemove={() => deck.remove(it.id)}
            onRetry={() => deck.retrySave(it.id)}
          />
        ))}
      </div>
      <AddButtons onFiles={() => input.current?.click()} onLibrary={() => setPicker(true)} full={state.videos.length >= VIDEO_LIMITS.videos} />
      <input
        ref={input}
        type="file"
        multiple
        accept="video/*"
        hidden
        data-testid="videos-file-input"
        onChange={(e) => {
          add(Array.from(e.target.files || []));
          e.target.value = "";
        }}
      />
      <form
        style={{ display: "flex", gap: 6 }}
        onSubmit={(e) => {
          e.preventDefault();
          addYouTube();
        }}
      >
        <input
          aria-label="YouTube link"
          placeholder="Paste a YouTube link"
          value={ytInput}
          onChange={(e) => setYtInput(e.target.value)}
          style={{ ...select, flex: 1, padding: "5px 8px" }}
        />
        <button type="submit" style={smallBtn} disabled={!ytInput.trim() || state.videos.length >= VIDEO_LIMITS.videos}>
          + YouTube
        </button>
      </form>
      {ytError && <div style={errBox}>{ytError}</div>}
      {hasYouTube && (
        <YouTubePlayerControls
          status={state.player}
          onOpen={() => deck.openPlayer()}
          onCapture={() => void deck.capturePlayer()}
          onDisconnect={() => deck.disconnectPlayer()}
        />
      )}
      {hasYouTube && (
        <div style={muted}>Only play videos you have the rights to stream. Destinations may mute or block copyrighted content.</div>
      )}
      {picker && (
        <LibraryPicker
          kind="video"
          onClose={() => setPicker(false)}
          onPick={(a) => {
            if (!deck.addFromLibrary({ id: a.id, name: a.name, url: a.videoUrl })) onNotice("The video playlist is full.");
          }}
        />
      )}
    </section>
  );
}

function VideoRow({
  item,
  playingIn,
  canBox,
  canStage,
  needsPlayer,
  onPlay,
  onVolume,
  onUp,
  onDown,
  onRemove,
  onRetry,
}: {
  item: VideoItem;
  playingIn: PlayTarget | null;
  canBox: boolean;
  canStage: boolean;
  needsPlayer: boolean;
  onPlay: (target: PlayTarget) => void;
  onVolume: (v: number) => void;
  onUp?: () => void;
  onDown?: () => void;
  onRemove: () => void;
  onRetry: () => void;
}) {
  const playable = item.kind === "youtube" ? !needsPlayer : !!item.url;
  const why = needsPlayer ? "Connect the YouTube player first" : !item.url && item.kind === "file" ? "Unavailable" : "";
  const btn = (target: PlayTarget, label: string, allowed: boolean) => {
    const live = playingIn === target;
    return (
      <button
        type="button"
        style={{
          ...smallBtn,
          padding: "2px 6px",
          color: live ? "#fca5a5" : "#86efac",
          borderColor: live ? "rgba(239,68,68,0.5)" : "rgba(34,197,94,0.5)",
        }}
        onClick={() => onPlay(target)}
        disabled={!allowed || !playable}
        title={why || (target === "box" ? `Play ${item.name} in my video box` : `Play ${item.name} on stage`)}
      >
        {live ? "● Live" : label}
      </button>
    );
  };
  return (
    <div data-testid="video-item" style={{ ...row, borderColor: playingIn ? "rgba(239,68,68,0.6)" : "rgba(255,255,255,0.08)" }}>
      {btn("box", "▶ Box", canBox)}
      {btn("stage", "▶ Stage", canStage)}
      <span style={{ ...ellipsis, flex: 1, fontSize: 12, color: playingIn ? "#fecaca" : "#e5e7eb" }} title={item.name}>
        {item.kind === "youtube" && <span style={{ color: "#f87171", fontWeight: 800 }}>YT </span>}
        {item.name}
      </span>
      <SaveBadge item={item} onRetry={onRetry} />
      <input type="range" aria-label={`${item.name} volume`} min={0} max={1} step={0.05} value={item.volume} onChange={(e) => onVolume(Number(e.target.value))} style={{ width: 48 }} />
      <button type="button" style={iconBtn} aria-label="Move up" onClick={onUp} disabled={!onUp}>
        ↑
      </button>
      <button type="button" style={iconBtn} aria-label="Move down" onClick={onDown} disabled={!onDown}>
        ↓
      </button>
      <button type="button" style={{ ...iconBtn, color: "#fca5a5" }} aria-label={`Remove ${item.name}`} onClick={onRemove}>
        ✕
      </button>
    </div>
  );
}

function AddButtons({ onFiles, onLibrary, full }: { onFiles: () => void; onLibrary: () => void; full: boolean }) {
  return (
    <div style={{ display: "flex", gap: 6 }}>
      <button type="button" style={smallBtn} onClick={onFiles} disabled={full}>
        + Add files
      </button>
      <button type="button" style={smallBtn} onClick={onLibrary} disabled={full}>
        From library
      </button>
      {full && <span style={muted}>Full</span>}
    </div>
  );
}

function SaveBadge({ item, onRetry }: { item: DeckItem | VideoItem; onRetry: () => void }) {
  if (item.saveState === "saving") {
    return <span style={badge("#93c5fd")}>Saving{typeof item.uploadPct === "number" ? ` ${item.uploadPct}%` : "…"}</span>;
  }
  if (item.saveState === "failed") {
    return (
      <span style={badge("#fca5a5")} title={item.saveError}>
        Not saved{" "}
        <button type="button" style={linkBtn} onClick={onRetry}>
          Retry
        </button>
      </span>
    );
  }
  if (item.saveState === "missing") return <span style={badge("#fcd34d")} title="This file is no longer in your library">Unavailable</span>;
  return null;
}

function ItemRow({
  item,
  active,
  onPlay,
  onVolume,
  onUp,
  onDown,
  onRemove,
  onRetry,
}: {
  item: DeckItem;
  active: boolean;
  onPlay: () => void;
  onVolume: (v: number) => void;
  onUp?: () => void;
  onDown?: () => void;
  onRemove: () => void;
  onRetry: () => void;
}) {
  return (
    <div data-testid="playlist-item" style={{ ...row, borderColor: active ? "rgba(16,185,129,0.6)" : "rgba(255,255,255,0.08)" }}>
      <button type="button" style={{ ...linkBtn, ...ellipsis, flex: 1, textAlign: "left", color: active ? "#6ee7b7" : "#e5e7eb" }} onClick={onPlay} disabled={!item.url} title={`Play ${item.name}`}>
        {active ? "▶ " : ""}
        {item.name}
      </button>
      <SaveBadge item={item} onRetry={onRetry} />
      <input type="range" aria-label={`${item.name} volume`} min={0} max={1} step={0.05} value={item.volume} onChange={(e) => onVolume(Number(e.target.value))} style={{ width: 56 }} />
      <button type="button" style={iconBtn} aria-label="Move up" onClick={onUp} disabled={!onUp}>
        ↑
      </button>
      <button type="button" style={iconBtn} aria-label="Move down" onClick={onDown} disabled={!onDown}>
        ↓
      </button>
      <button type="button" style={{ ...iconBtn, color: "#fca5a5" }} aria-label={`Remove ${item.name}`} onClick={onRemove}>
        ✕
      </button>
    </div>
  );
}

function Pad({
  pad,
  playing,
  onPlay,
  onStop,
  onVolume,
  onRemove,
  onRetry,
}: {
  pad: DeckItem;
  playing: boolean;
  onPlay: () => void;
  onStop: () => void;
  onVolume: (v: number) => void;
  onRemove: () => void;
  onRetry: () => void;
}) {
  return (
    <div data-testid="pad" style={{ display: "grid", gap: 3 }}>
      <button
        type="button"
        onClick={playing ? onStop : onPlay}
        disabled={!pad.url && !pad.assetId}
        title={playing ? `Stop ${pad.name}` : `Play ${pad.name}`}
        style={{
          ...ellipsis,
          height: 44,
          borderRadius: 8,
          border: playing ? "1px solid #f472b6" : "1px solid rgba(255,255,255,0.15)",
          background: playing ? "rgba(236,72,153,0.3)" : "rgba(139,92,246,0.15)",
          color: "#f5f3ff",
          fontSize: 11,
          fontWeight: 700,
          cursor: "pointer",
          padding: "0 4px",
        }}
      >
        {pad.name}
      </button>
      <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
        <input type="range" aria-label={`${pad.name} volume`} min={0} max={1} step={0.05} value={pad.volume} onChange={(e) => onVolume(Number(e.target.value))} style={{ flex: 1, minWidth: 0 }} />
        <button type="button" style={{ ...iconBtn, color: "#fca5a5", padding: 0 }} aria-label={`Remove ${pad.name}`} onClick={onRemove}>
          ✕
        </button>
      </div>
      <SaveBadge item={pad} onRetry={onRetry} />
    </div>
  );
}

/** Library files a list can use: audio for the deck, finished videos/recordings for the stage. */
function libraryFilter(kind: "audio" | "video", a: MediaAsset): boolean {
  if (!a.videoUrl) return false;
  if (kind === "audio") return a.type === "audio";
  if (a.type === "recording") return a.status === "ready" && a.hasVideo !== false;
  return a.type === "video" && a.hasVideo !== false;
}

function LibraryPicker({
  kind,
  onClose,
  onPick,
}: {
  kind: "audio" | "video";
  onClose: () => void;
  onPick: (a: MediaAsset) => void;
}) {
  const [items, setItems] = useState<MediaAsset[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    assetsApi
      .list()
      .then((all) => {
        if (!cancelled) setItems(all.filter((a) => libraryFilter(kind, a)));
      })
      .catch(() => {
        if (!cancelled) setError("Couldn't load your library.");
      });
    return () => {
      cancelled = true;
    };
  }, [kind]);
  return (
    <div style={pickerBox} data-testid="library-picker">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={sectionTitle}>{kind === "audio" ? "Audio" : "Videos"} in your library</div>
        <button type="button" style={iconBtn} aria-label="Close library" onClick={onClose}>
          ✕
        </button>
      </div>
      {error && <div style={errBox}>{error}</div>}
      {!items && !error && <div style={muted}>Loading…</div>}
      {items && items.length === 0 && (
        <div style={muted}>{kind === "audio" ? "No audio files" : "No videos"} yet. Add files to upload them.</div>
      )}
      <div style={{ display: "grid", gap: 4, maxHeight: 200, overflowY: "auto" }}>
        {items?.map((a) => (
          <button key={a.id} type="button" style={{ ...row, ...linkBtn, color: "#e5e7eb", justifyContent: "space-between" }} onClick={() => onPick(a)}>
            <span style={ellipsis}>{a.name}</span>
            <span style={muted}>{a.duration ? fmt(a.duration) : ""}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Drop media files anywhere on the room: a full-screen target appears while
 * dragging, split into Videos / Playlist / Soundboard.
 */
export function AudioDropOverlay({ onDropped }: { onDropped: () => void }) {
  const { deck } = useAudioDeck();
  const { deck: videoDeck } = useVideoDeck();
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);

  useEffect(() => {
    const hasFiles = (e: globalThis.DragEvent) => Array.from(e.dataTransfer?.types || []).includes("Files");
    const enter = (e: globalThis.DragEvent) => {
      if (!hasFiles(e)) return;
      depth.current += 1;
      setDragging(true);
    };
    const leave = () => {
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setDragging(false);
    };
    const end = () => {
      depth.current = 0;
      setDragging(false);
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", end);
    window.addEventListener("dragend", end);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", end);
      window.removeEventListener("dragend", end);
    };
  }, []);

  if (!dragging) return null;
  const zone = (list: DeckList | "videos", label: string) => (
    <div
      data-testid={`room-drop-${list}`}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        depth.current = 0;
        setDragging(false);
        if (list === "videos") {
          void videoDeck.ensureLoaded();
          if (videoDeck.addFiles(Array.from(e.dataTransfer?.files || []).filter(isVideoFile)) > 0) onDropped();
          return;
        }
        void deck.ensureLoaded();
        if (deck.addFiles(droppedAudio(e), list) > 0) onDropped();
      }}
      style={{
        flex: 1,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        border: "2px dashed rgba(167,139,250,0.8)",
        borderRadius: 16,
        color: "#ede9fe",
        fontSize: 18,
        fontWeight: 800,
        background: "rgba(76,29,149,0.35)",
      }}
    >
      {label}
    </div>
  );
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 60, display: "flex", gap: 16, padding: 24, background: "rgba(0,0,0,0.55)" }}>
      {zone("videos", "Drop to add stage videos")}
      {zone("playlist", "Drop to add to the playlist")}
      {zone("pads", "Drop to add soundboard pads")}
    </div>
  );
}

// Fixed below the room's top bar (the room area is 100vh - 60px).
const panel: CSSProperties = {
  position: "fixed",
  top: 68,
  right: 12,
  width: 340,
  maxWidth: "calc(100vw - 24px)",
  maxHeight: "calc(100vh - 84px)",
  overflowY: "auto",
  zIndex: 32,
  borderRadius: 12,
  padding: 12,
  display: "grid",
  gap: 10,
  background: "rgba(15,23,42,0.97)",
  border: "1px solid rgba(255,255,255,0.12)",
  boxShadow: "0 10px 30px rgba(0,0,0,0.5)",
};
const section: CSSProperties = { display: "grid", gap: 6 };
const sectionTitle: CSSProperties = { fontSize: 12, fontWeight: 800, color: "#cbd5e1" };
const muted: CSSProperties = { fontSize: 11, color: "#64748b" };
const ellipsis: CSSProperties = { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };
const row: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 4,
  padding: "4px 6px",
  borderRadius: 8,
  border: "1px solid rgba(255,255,255,0.08)",
  background: "rgba(255,255,255,0.02)",
};
const iconBtn: CSSProperties = { background: "none", border: "none", color: "#94a3b8", cursor: "pointer", fontSize: 12, padding: "0 3px" };
const linkBtn: CSSProperties = { background: "none", border: "none", cursor: "pointer", padding: 0, fontSize: 12 };
const smallBtn: CSSProperties = {
  padding: "4px 8px",
  borderRadius: 6,
  border: "1px solid rgba(255,255,255,0.15)",
  background: "transparent",
  color: "#cbd5e1",
  fontSize: 11,
  cursor: "pointer",
};
const ctrlBtn: CSSProperties = {
  width: 32,
  height: 26,
  borderRadius: 6,
  border: "none",
  background: "rgba(55,65,81,0.8)",
  color: "#e5e7eb",
  cursor: "pointer",
  fontSize: 12,
};
const select: CSSProperties = {
  padding: "3px 6px",
  borderRadius: 6,
  border: "1px solid rgba(255,255,255,0.15)",
  background: "rgba(0,0,0,0.3)",
  color: "#e5e7eb",
  fontSize: 11,
};
const hintBox: CSSProperties = {
  padding: "6px 8px",
  borderRadius: 8,
  background: "rgba(59,130,246,0.1)",
  border: "1px solid rgba(59,130,246,0.35)",
  color: "#bfdbfe",
  fontSize: 11,
};
const warnBox: CSSProperties = { ...hintBox, background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.35)", color: "#fde68a" };
const errBox: CSSProperties = { ...hintBox, background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.35)", color: "#fca5a5" };
const pickerBox: CSSProperties = { ...section, padding: 8, borderRadius: 8, border: "1px solid rgba(255,255,255,0.15)", background: "rgba(0,0,0,0.35)" };
function dropBox(over: boolean): CSSProperties {
  return {
    display: "grid",
    gap: 4,
    padding: 6,
    borderRadius: 8,
    minHeight: 40,
    border: over ? "1px dashed #a78bfa" : "1px dashed rgba(255,255,255,0.1)",
    background: over ? "rgba(139,92,246,0.12)" : "transparent",
  };
}
function badge(color: string): CSSProperties {
  return { fontSize: 10, color, whiteSpace: "nowrap" };
}
