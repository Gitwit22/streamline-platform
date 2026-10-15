import { useEffect, useState, type CSSProperties } from "react";
import {
  GRAPHICS_LIMITS,
  EMPTY_ROOM_GRAPHICS,
  GraphicsError,
  getRoomGraphics,
  newGraphicsId,
  saveRoomGraphics,
  type RoomGraphics,
} from "../../lib/roomGraphics";

/**
 * In-room producer panel for live graphics: lower thirds and banners. Every
 * change is saved to the server, which pushes the visible ones to all
 * outputs; the panel never shows a change as applied until the save succeeds.
 */
export default function GraphicsPanel({
  open,
  onClose,
  roomId,
  roomAccessToken,
}: {
  open: boolean;
  onClose: () => void;
  roomId: string;
  roomAccessToken: string;
}) {
  const [graphics, setGraphics] = useState<RoomGraphics>(EMPTY_ROOM_GRAPHICS);
  const [rev, setRev] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  // Lower third form ("" = adding a new one, else editing that id).
  const [ltEditId, setLtEditId] = useState("");
  const [ltName, setLtName] = useState("");
  const [ltTitle, setLtTitle] = useState("");
  // Banner form.
  const [bnEditId, setBnEditId] = useState("");
  const [bnText, setBnText] = useState("");
  const [bnScroll, setBnScroll] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    getRoomGraphics(roomId, roomAccessToken)
      .then((snap) => {
        if (cancelled) return;
        setGraphics(snap.graphics);
        setRev(snap.rev);
        setLoaded(true);
        setLoadError(null);
      })
      .catch((e) => {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : "Couldn't load graphics.");
      });
    return () => {
      cancelled = true;
    };
  }, [open, roomId, roomAccessToken, reloadKey]);

  if (!open) return null;

  /** Saves `next`; returns true when the server accepted it. */
  const save = async (next: RoomGraphics): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      const snap = await saveRoomGraphics(roomId, roomAccessToken, next, rev);
      setGraphics(snap.graphics);
      setRev(snap.rev);
      return true;
    } catch (e) {
      if (e instanceof GraphicsError && e.current) {
        setGraphics(e.current.graphics);
        setRev(e.current.rev);
      }
      setError(e instanceof Error ? e.message : "Couldn't save graphics.");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const resetLtForm = () => {
    setLtEditId("");
    setLtName("");
    setLtTitle("");
  };
  const resetBnForm = () => {
    setBnEditId("");
    setBnText("");
    setBnScroll(false);
  };

  const submitLowerThird = async () => {
    const name = ltName.trim();
    if (!name) return;
    const item = { id: ltEditId || newGraphicsId("lt"), name, title: ltTitle.trim() };
    const lowerThirds = ltEditId
      ? graphics.lowerThirds.map((x) => (x.id === ltEditId ? item : x))
      : [...graphics.lowerThirds, item];
    if (await save({ ...graphics, lowerThirds })) resetLtForm();
  };

  const submitBanner = async () => {
    const text = bnText.trim();
    if (!text) return;
    const item = { id: bnEditId || newGraphicsId("bn"), text, scroll: bnScroll };
    const banners = bnEditId ? graphics.banners.map((x) => (x.id === bnEditId ? item : x)) : [...graphics.banners, item];
    if (await save({ ...graphics, banners })) resetBnForm();
  };

  const ltFull = !ltEditId && graphics.lowerThirds.length >= GRAPHICS_LIMITS.items;
  const bnFull = !bnEditId && graphics.banners.length >= GRAPHICS_LIMITS.items;

  return (
    <div data-testid="graphics-panel" style={panel}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontWeight: 800, color: "#e5e7eb", fontSize: 14 }}>Graphics</div>
        <button type="button" onClick={onClose} style={closeBtn} aria-label="Close graphics">
          ✕
        </button>
      </div>
      <div style={{ fontSize: 11, color: "#94a3b8" }}>Shown on every output: destinations, HLS and recordings.</div>

      {loadError && !loaded && (
        <div style={{ display: "grid", gap: 6 }}>
          <div style={errBox}>{loadError}</div>
          <button type="button" style={smallBtn} onClick={() => setReloadKey((k) => k + 1)}>
            Retry
          </button>
        </div>
      )}
      {!loaded && !loadError && <div style={{ fontSize: 12, color: "#94a3b8" }}>Loading…</div>}

      {loaded && (
        <>
          {error && <div style={errBox}>{error}</div>}

          <section style={section}>
            <div style={sectionTitle}>Lower thirds</div>
            {graphics.lowerThirds.length === 0 && <div style={empty}>None yet.</div>}
            {graphics.lowerThirds.map((lt) => {
              const live = graphics.activeLowerThirdId === lt.id;
              return (
                <div key={lt.id} style={row(live)} data-testid="lower-third-row">
                  <div style={{ minWidth: 0 }}>
                    <div style={{ ...ellipsis, fontWeight: 700, color: "#f1f5f9", fontSize: 12 }}>{lt.name}</div>
                    {lt.title && <div style={{ ...ellipsis, color: "#94a3b8", fontSize: 11 }}>{lt.title}</div>}
                  </div>
                  <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                    <button
                      type="button"
                      style={live ? hideBtn : showBtn}
                      disabled={busy}
                      onClick={() => void save({ ...graphics, activeLowerThirdId: live ? null : lt.id })}
                    >
                      {live ? "Hide" : "Show"}
                    </button>
                    <button
                      type="button"
                      style={smallBtn}
                      disabled={busy}
                      onClick={() => {
                        setLtEditId(lt.id);
                        setLtName(lt.name);
                        setLtTitle(lt.title);
                      }}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      style={{ ...smallBtn, color: "#fca5a5" }}
                      disabled={busy}
                      aria-label={`Delete ${lt.name}`}
                      onClick={() =>
                        void save({
                          ...graphics,
                          lowerThirds: graphics.lowerThirds.filter((x) => x.id !== lt.id),
                          activeLowerThirdId: live ? null : graphics.activeLowerThirdId,
                        })
                      }
                    >
                      ✕
                    </button>
                  </div>
                </div>
              );
            })}
            <input
              style={input}
              placeholder="Name"
              aria-label="Lower third name"
              value={ltName}
              maxLength={GRAPHICS_LIMITS.name}
              onChange={(e) => setLtName(e.target.value)}
            />
            <input
              style={input}
              placeholder="Title (optional)"
              aria-label="Lower third title"
              value={ltTitle}
              maxLength={GRAPHICS_LIMITS.title}
              onChange={(e) => setLtTitle(e.target.value)}
            />
            <div style={{ display: "flex", gap: 6 }}>
              <button
                type="button"
                style={primaryBtn}
                disabled={busy || !ltName.trim() || ltFull}
                onClick={() => void submitLowerThird()}
              >
                {ltEditId ? "Update" : "Add lower third"}
              </button>
              {ltEditId && (
                <button type="button" style={smallBtn} onClick={resetLtForm}>
                  Cancel
                </button>
              )}
            </div>
            {ltFull && <div style={empty}>Up to {GRAPHICS_LIMITS.items} lower thirds.</div>}
          </section>

          <section style={section}>
            <div style={sectionTitle}>Banners</div>
            {graphics.banners.length === 0 && <div style={empty}>None yet.</div>}
            {graphics.banners.map((bn) => {
              const live = graphics.activeBannerId === bn.id;
              return (
                <div key={bn.id} style={row(live)} data-testid="banner-row">
                  <div style={{ minWidth: 0 }}>
                    <div style={{ ...ellipsis, color: "#f1f5f9", fontSize: 12 }}>{bn.text}</div>
                    <div style={{ color: "#94a3b8", fontSize: 11 }}>{bn.scroll ? "Scrolling" : "Static"}</div>
                  </div>
                  <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                    <button
                      type="button"
                      style={live ? hideBtn : showBtn}
                      disabled={busy}
                      onClick={() => void save({ ...graphics, activeBannerId: live ? null : bn.id })}
                    >
                      {live ? "Hide" : "Show"}
                    </button>
                    <button
                      type="button"
                      style={smallBtn}
                      disabled={busy}
                      onClick={() => {
                        setBnEditId(bn.id);
                        setBnText(bn.text);
                        setBnScroll(bn.scroll);
                      }}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      style={{ ...smallBtn, color: "#fca5a5" }}
                      disabled={busy}
                      aria-label="Delete banner"
                      onClick={() =>
                        void save({
                          ...graphics,
                          banners: graphics.banners.filter((x) => x.id !== bn.id),
                          activeBannerId: live ? null : graphics.activeBannerId,
                        })
                      }
                    >
                      ✕
                    </button>
                  </div>
                </div>
              );
            })}
            <textarea
              style={{ ...input, resize: "vertical" }}
              rows={2}
              placeholder="Banner text"
              aria-label="Banner text"
              value={bnText}
              maxLength={GRAPHICS_LIMITS.bannerText}
              onChange={(e) => setBnText(e.target.value)}
            />
            <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12, color: "#cbd5e1" }}>
              <input type="checkbox" checked={bnScroll} onChange={(e) => setBnScroll(e.target.checked)} />
              Scroll across the screen
            </label>
            <div style={{ display: "flex", gap: 6 }}>
              <button
                type="button"
                style={primaryBtn}
                disabled={busy || !bnText.trim() || bnFull}
                onClick={() => void submitBanner()}
              >
                {bnEditId ? "Update" : "Add banner"}
              </button>
              {bnEditId && (
                <button type="button" style={smallBtn} onClick={resetBnForm}>
                  Cancel
                </button>
              )}
            </div>
            {bnFull && <div style={empty}>Up to {GRAPHICS_LIMITS.items} banners.</div>}
          </section>
          <div style={{ fontSize: 11, color: "#64748b" }}>Colors come from the room's brand kit (Settings → Branding).</div>
        </>
      )}
    </div>
  );
}

const panel: CSSProperties = {
  position: "absolute",
  top: 8,
  right: 8,
  width: 320,
  maxHeight: "calc(100% - 16px)",
  overflowY: "auto",
  zIndex: 31,
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
const empty: CSSProperties = { fontSize: 11, color: "#64748b" };
const ellipsis: CSSProperties = { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };
const input: CSSProperties = {
  width: "100%",
  padding: "7px 9px",
  borderRadius: 8,
  border: "1px solid rgba(255,255,255,0.12)",
  background: "rgba(0,0,0,0.3)",
  color: "#e5e7eb",
  fontSize: 12,
};
const smallBtn: CSSProperties = {
  padding: "4px 8px",
  borderRadius: 6,
  border: "1px solid rgba(255,255,255,0.15)",
  background: "transparent",
  color: "#cbd5e1",
  fontSize: 11,
  cursor: "pointer",
};
const showBtn: CSSProperties = { ...smallBtn, border: "1px solid rgba(34,197,94,0.5)", color: "#86efac" };
const hideBtn: CSSProperties = { ...smallBtn, border: "1px solid rgba(239,68,68,0.6)", background: "rgba(239,68,68,0.15)", color: "#fca5a5" };
const primaryBtn: CSSProperties = {
  padding: "6px 10px",
  borderRadius: 8,
  border: "none",
  background: "linear-gradient(135deg,#dc2626,#ef4444)",
  color: "#fff",
  fontSize: 12,
  fontWeight: 700,
  cursor: "pointer",
};
const closeBtn: CSSProperties = { background: "none", border: "none", color: "#94a3b8", cursor: "pointer", fontSize: 14 };
const errBox: CSSProperties = {
  padding: "6px 8px",
  borderRadius: 8,
  background: "rgba(239,68,68,0.12)",
  border: "1px solid rgba(239,68,68,0.35)",
  color: "#fca5a5",
  fontSize: 12,
};
function row(live: boolean): CSSProperties {
  return {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
    padding: "6px 8px",
    borderRadius: 8,
    border: live ? "1px solid rgba(239,68,68,0.6)" : "1px solid rgba(255,255,255,0.08)",
    background: live ? "rgba(239,68,68,0.08)" : "rgba(255,255,255,0.02)",
  };
}
