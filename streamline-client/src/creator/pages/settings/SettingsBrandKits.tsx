import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { BrandingFields, HlsViewerPreview, TextField } from "../../components/HlsBrandingEditor";
import { EMPTY_BRANDING, validateBranding, type HlsBranding } from "../../../lib/hlsBranding";
import {
  BRAND_KIT_NAME_MAX,
  createBrandKit,
  deleteBrandKit,
  listBrandKits,
  setDefaultBrandKit,
  updateBrandKit,
  type BrandKit,
  type BrandKitInput,
  type BrandKitList,
} from "../../../lib/brandKits";

type Draft = BrandKitInput;

const EMPTY_DRAFT: Draft = { ...EMPTY_BRANDING, name: "" };

function draftFromKit(kit: BrandKit): Draft {
  const { title, subtitle, logoUrl, offlineMessage, theme, name } = kit;
  return { title, subtitle, logoUrl, offlineMessage, theme, name };
}

function errorMessage(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback;
}

function draftEquals(a: Draft, b: Draft): boolean {
  return (
    a.name.trim() === b.name.trim() &&
    a.title === b.title &&
    a.subtitle === b.subtitle &&
    a.logoUrl.trim() === b.logoUrl.trim() &&
    a.offlineMessage === b.offlineMessage &&
    a.theme === b.theme
  );
}

/**
 * Settings -> Branding: create and edit reusable brand kits and pick the
 * default kit that new rooms start with. A room's kit decides what its HLS
 * viewer page shows (title, subtitle, logo, theme, offline message).
 */
export default function SettingsBrandKits({ onUpgrade }: { onUpgrade?: () => void }) {
  const [list, setList] = useState<BrandKitList | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  // "new" = creating; a kit id = editing that kit; null = nothing open.
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [makeDefault, setMakeDefault] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [logoBroken, setLogoBroken] = useState(false);

  const reload = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setList(await listBrandKits());
    } catch (e) {
      setLoadError(errorMessage(e, "Failed to load brand kits."));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    listBrandKits()
      .then((next) => {
        if (!cancelled) setList(next);
      })
      .catch((e) => {
        if (!cancelled) setLoadError(errorMessage(e, "Failed to load brand kits."));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const kits = list?.kits || [];
  const canEdit = list?.canEdit === true;
  const editingKit = editing && editing !== "new" ? kits.find((k) => k.id === editing) || null : null;
  const baseline = editingKit ? draftFromKit(editingKit) : EMPTY_DRAFT;
  const dirty = editing !== null && !draftEquals(draft, baseline);

  const errors = useMemo(() => {
    const e: Partial<Record<keyof Draft, string>> = validateBranding(draft);
    if (!draft.name.trim()) e.name = "Give the kit a name.";
    else if (draft.name.trim().length > BRAND_KIT_NAME_MAX) e.name = `Name must be ${BRAND_KIT_NAME_MAX} characters or less.`;
    return e;
  }, [draft]);
  const hasErrors = Object.keys(errors).length > 0;

  const confirmDiscard = () => !dirty || window.confirm("Discard your unsaved changes to this kit?");

  const openNew = () => {
    if (!confirmDiscard()) return;
    setEditing("new");
    setDraft(EMPTY_DRAFT);
    setLogoBroken(false);
    // The first kit becomes the default unless the user unticks it.
    setMakeDefault(kits.length === 0);
    setError(null);
    setMessage(null);
  };

  const openKit = (kit: BrandKit) => {
    if (!confirmDiscard()) return;
    setEditing(kit.id);
    setDraft(draftFromKit(kit));
    setLogoBroken(false);
    setError(null);
    setMessage(null);
  };

  const close = () => {
    if (!confirmDiscard()) return;
    setEditing(null);
    setError(null);
  };

  const setField = <K extends keyof HlsBranding>(key: K, value: HlsBranding[K]) => {
    setMessage(null);
    if (key === "logoUrl") setLogoBroken(false);
    setDraft((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = async () => {
    if (!canEdit || hasErrors || busy || !editing) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      if (editing === "new") {
        const { kit, defaultKitId } = await createBrandKit(draft, makeDefault);
        setList((prev) => ({
          canEdit: prev?.canEdit ?? true,
          blockedReason: prev?.blockedReason ?? null,
          defaultKitId,
          kits: [...(prev?.kits || []), kit].sort((a, b) => a.name.localeCompare(b.name)),
        }));
        setEditing(kit.id);
        setDraft(draftFromKit(kit));
        setMessage("Kit created.");
      } else {
        const kit = await updateBrandKit(editing, draft);
        setList((prev) =>
          prev ? { ...prev, kits: prev.kits.map((k) => (k.id === kit.id ? kit : k)).sort((a, b) => a.name.localeCompare(b.name)) } : prev
        );
        setDraft(draftFromKit(kit));
        setMessage("Saved — rooms using this kit show it to viewers on their next load.");
      }
    } catch (e) {
      setError(errorMessage(e, "Failed to save the kit."));
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (kit: BrandKit) => {
    const ok = window.confirm(
      `Delete the “${kit.name}” brand kit? Rooms using it go back to their own channel branding. This can't be undone.`
    );
    if (!ok) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await deleteBrandKit(kit.id);
      setList((prev) =>
        prev
          ? {
              ...prev,
              kits: prev.kits.filter((k) => k.id !== kit.id),
              defaultKitId: prev.defaultKitId === kit.id ? null : prev.defaultKitId,
            }
          : prev
      );
      if (editing === kit.id) setEditing(null);
      setMessage(`Deleted “${kit.name}”.`);
    } catch (e) {
      setError(errorMessage(e, "Failed to delete the kit."));
    } finally {
      setBusy(false);
    }
  };

  const handleDefault = async (kitId: string | null) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const next = await setDefaultBrandKit(kitId);
      setList((prev) => (prev ? { ...prev, defaultKitId: next } : prev));
    } catch (e) {
      setError(errorMessage(e, "Failed to change the default kit."));
    } finally {
      setBusy(false);
    }
  };

  if (loading && !list) return <div style={{ color: "#9ca3af", fontSize: 13 }}>Loading brand kits…</div>;
  if (loadError && !list) {
    return (
      <div style={{ display: "grid", gap: 10 }}>
        <div style={errorStyle}>{loadError}</div>
        <div>
          <button type="button" style={btnSecondary} onClick={() => void reload()}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: 14 }} data-testid="brand-kits">
      <p style={{ color: "#94a3b8", margin: 0, fontSize: 13, lineHeight: 1.5 }}>
        A brand kit is a reusable look for your viewer page: title, subtitle, logo, theme and offline message. New rooms
        start with your default kit, and you can pick a different kit (or none) when you create a room. Editing a kit
        updates every room that uses it.
      </p>

      {!canEdit && (
        <div style={noticeStyle}>
          <div style={{ fontWeight: 800, marginBottom: 4 }}>
            {list?.blockedReason === "platform" ? "Branding is temporarily disabled" : "Brand kits are not included in your plan"}
          </div>
          <div style={{ color: "#fcd34d" }}>
            {list?.blockedReason === "platform"
              ? "Kits can't be changed right now. Rooms keep their current branding."
              : "Existing kits stay in place. Upgrade to create or edit kits."}
          </div>
          {list?.blockedReason !== "platform" && onUpgrade && (
            <button type="button" onClick={onUpgrade} style={{ ...btnPrimary, marginTop: 10 }}>
              Upgrade
            </button>
          )}
        </div>
      )}

      <div style={{ display: "grid", gap: 8 }}>
        {kits.length === 0 && <div style={{ color: "#9ca3af", fontSize: 13 }}>You don't have any brand kits yet.</div>}
        {kits.map((kit) => {
          const isDefault = list?.defaultKitId === kit.id;
          return (
            <div key={kit.id} style={rowStyle(editing === kit.id)} data-testid="brand-kit-row">
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 800, color: "#e5e7eb", fontSize: 14, ...ellipsis }}>
                  {kit.name}
                  {isDefault && <span style={badgeStyle}>Default</span>}
                </div>
                <div style={{ fontSize: 12, color: "#9ca3af", ...ellipsis }}>
                  {kit.title || "No title"} · {kit.theme === "light" ? "Light" : "Dark"} theme
                </div>
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
                <button type="button" style={btnSmall} disabled={busy} onClick={() => openKit(kit)}>
                  {canEdit ? "Edit" : "View"}
                </button>
                {isDefault ? (
                  <button type="button" style={btnSmall} disabled={busy} onClick={() => void handleDefault(null)}>
                    Unset default
                  </button>
                ) : (
                  <button type="button" style={btnSmall} disabled={busy || !canEdit} onClick={() => void handleDefault(kit.id)}>
                    Make default
                  </button>
                )}
                <button type="button" style={{ ...btnSmall, color: "#fca5a5" }} disabled={busy} onClick={() => void handleDelete(kit)}>
                  Delete
                </button>
              </div>
            </div>
          );
        })}
        <div>
          <button type="button" style={{ ...btnPrimary, opacity: canEdit ? 1 : 0.5 }} disabled={!canEdit || busy} onClick={openNew}>
            New brand kit
          </button>
        </div>
      </div>

      {error && <div style={errorStyle}>{error}</div>}
      {message && <div style={okStyle}>{message}</div>}

      {editing && (
        <div style={panelStyle} data-testid="brand-kit-editor">
          <div style={{ fontWeight: 800, color: "#e5e7eb" }}>{editing === "new" ? "New brand kit" : `Edit “${editingKit?.name || ""}”`}</div>
          <TextField
            label="Kit name"
            placeholder="e.g. Main show"
            value={draft.name}
            max={BRAND_KIT_NAME_MAX}
            disabled={!canEdit || busy}
            error={errors.name}
            hint="Only you see this name."
            onChange={(v) => {
              setMessage(null);
              setDraft((prev) => ({ ...prev, name: v }));
            }}
          />
          <BrandingFields
            draft={draft}
            errors={errors}
            disabled={!canEdit || busy}
            logoBroken={logoBroken}
            titlePlaceholder="Your channel name"
            subtitlePlaceholder="Live Viewer"
            onChange={setField}
          />
          {editing === "new" && (
            <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, color: "#e5e7eb" }}>
              <input type="checkbox" checked={makeDefault} disabled={busy} onChange={(e) => setMakeDefault(e.target.checked)} />
              Use as the default for new rooms
            </label>
          )}
          <div>
            <div style={{ fontSize: 12, color: "#9ca3af", fontWeight: 800, marginBottom: 6 }}>Preview</div>
            <HlsViewerPreview branding={draft} embedName={draft.name} onLogoError={() => setLogoBroken(true)} />
          </div>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button type="button" style={btnSecondary} disabled={busy} onClick={close}>
              {dirty ? "Cancel" : "Close"}
            </button>
            {canEdit && (
              <button
                type="button"
                style={{ ...btnPrimary, opacity: busy || hasErrors || !dirty ? 0.5 : 1 }}
                disabled={busy || hasErrors || !dirty}
                onClick={() => void handleSave()}
              >
                {busy ? "Saving…" : editing === "new" ? "Create kit" : "Save kit"}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const ellipsis: CSSProperties = { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };
const panelStyle: CSSProperties = {
  display: "grid",
  gap: 12,
  padding: 14,
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.08)",
  background: "rgba(255,255,255,0.02)",
};
function rowStyle(active: boolean): CSSProperties {
  return {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap",
    padding: "10px 12px",
    borderRadius: 10,
    border: active ? "1px solid rgba(220,38,38,0.6)" : "1px solid rgba(255,255,255,0.08)",
    background: "rgba(255,255,255,0.02)",
  };
}
const badgeStyle: CSSProperties = {
  marginLeft: 8,
  padding: "2px 8px",
  borderRadius: 999,
  fontSize: 10,
  fontWeight: 800,
  color: "#bbf7d0",
  border: "1px solid rgba(34,197,94,0.4)",
  background: "rgba(34,197,94,0.1)",
};
const noticeStyle: CSSProperties = {
  padding: "10px 12px",
  borderRadius: 12,
  background: "rgba(245,158,11,0.10)",
  border: "1px solid rgba(245,158,11,0.35)",
  color: "#fde68a",
  fontSize: 13,
};
const errorStyle: CSSProperties = {
  padding: "8px 10px",
  borderRadius: 10,
  background: "rgba(239,68,68,0.12)",
  border: "1px solid rgba(239,68,68,0.35)",
  color: "#fca5a5",
  fontSize: 13,
};
const okStyle: CSSProperties = {
  padding: "8px 10px",
  borderRadius: 10,
  background: "rgba(34,197,94,0.10)",
  border: "1px solid rgba(34,197,94,0.35)",
  color: "#bbf7d0",
  fontSize: 13,
};
const btnPrimary: CSSProperties = {
  padding: "10px 16px",
  borderRadius: 10,
  border: "none",
  background: "linear-gradient(135deg,#dc2626,#ef4444)",
  color: "#fff",
  fontSize: 13,
  fontWeight: 700,
  cursor: "pointer",
};
const btnSecondary: CSSProperties = {
  padding: "10px 14px",
  borderRadius: 10,
  border: "1px solid rgba(148,163,184,0.4)",
  background: "rgba(15,23,42,0.6)",
  color: "#e5e7eb",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
};
const btnSmall: CSSProperties = { ...btnSecondary, padding: "6px 10px", fontSize: 12 };
