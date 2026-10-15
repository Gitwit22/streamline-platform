import { useEffect, useRef, useState, type CSSProperties, type DragEvent } from "react";
import { useAudioDeck } from "../hooks/useAudioDeck";
import { DECK_LIMITS, isAudioFile, type DeckItem, type DeckList, type LoopMode } from "../../lib/audioDeck";
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
 * In-room audio deck: background-music playlist and soundboard pads. Audio
 * plays into the mixer's Music channel; files are saved to the content
 * library so the deck is there next session.
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
        <div style={{ fontWeight: 800, color: "#e5e7eb", fontSize: 14 }}>🎵 Audio</div>
        <button type="button" onClick={onClose} style={iconBtn} aria-label="Close audio">
          ✕
        </button>
      </div>

      {!broadcasting && (
        <div style={hintBox} data-testid="audio-not-broadcasting">
          Only you hear this right now. Turn on <b>Send mix to stream</b> in the mixer so guests and viewers hear it.
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
        Plays through the mixer's Music channel. Added files are saved to your content library.
      </div>

      {picker && (
        <LibraryPicker
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

function SaveBadge({ item, onRetry }: { item: DeckItem; onRetry: () => void }) {
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

function LibraryPicker({ onClose, onPick }: { onClose: () => void; onPick: (a: MediaAsset) => void }) {
  const [items, setItems] = useState<MediaAsset[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    assetsApi
      .list()
      .then((all) => {
        if (!cancelled) setItems(all.filter((a) => a.type === "audio" && !!a.videoUrl));
      })
      .catch(() => {
        if (!cancelled) setError("Couldn't load your library.");
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return (
    <div style={pickerBox} data-testid="library-picker">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={sectionTitle}>Audio in your library</div>
        <button type="button" style={iconBtn} aria-label="Close library" onClick={onClose}>
          ✕
        </button>
      </div>
      {error && <div style={errBox}>{error}</div>}
      {!items && !error && <div style={muted}>Loading…</div>}
      {items && items.length === 0 && <div style={muted}>No audio files yet. Add files to upload them.</div>}
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
 * Drop audio files anywhere on the room: a full-screen target appears while
 * dragging, split into Playlist / Soundboard.
 */
export function AudioDropOverlay({ onDropped }: { onDropped: () => void }) {
  const { deck } = useAudioDeck();
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
  const zone = (list: DeckList, label: string) => (
    <div
      data-testid={`room-drop-${list}`}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        depth.current = 0;
        setDragging(false);
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
