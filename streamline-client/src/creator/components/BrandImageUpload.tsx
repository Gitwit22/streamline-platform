import { useRef, useState, type CSSProperties } from "react";
import { BRAND_IMAGE_ACCEPT, uploadBrandImage } from "../../lib/brandAssets";

/**
 * "Upload image" control for branding image fields (logo, video background).
 * Uploads the picked file and hands back its URL via onUploaded; the caller
 * stores it in the same field a pasted URL would go in.
 */
export function BrandImageUpload({
  label,
  hasImage,
  disabled,
  onUploaded,
  onClear,
  testId,
}: {
  label: string;
  /** A URL is currently set (shows "Replace" and "Remove"). */
  hasImage: boolean;
  disabled: boolean;
  onUploaded: (url: string) => void;
  onClear: () => void;
  testId?: string;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setUploading(true);
    try {
      onUploaded(await uploadBrandImage(file));
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : "Upload failed. Try again.");
    } finally {
      setUploading(false);
      // Allow picking the same file again after an error.
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const busy = disabled || uploading;
  return (
    <div style={{ display: "grid", gap: 4 }} data-testid={testId}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <input
          ref={inputRef}
          type="file"
          accept={BRAND_IMAGE_ACCEPT}
          aria-label={label}
          disabled={busy}
          style={{ display: "none" }}
          onChange={(e) => void handleFile(e.target.files?.[0])}
        />
        <button type="button" style={{ ...btn, opacity: busy ? 0.5 : 1 }} disabled={busy} onClick={() => inputRef.current?.click()}>
          {uploading ? "Uploading…" : hasImage ? "Replace image" : label}
        </button>
        {hasImage && (
          <button type="button" style={linkBtn} disabled={busy} onClick={onClear}>
            Remove
          </button>
        )}
        <span style={{ fontSize: 11, color: "#6b7280" }}>PNG, JPG, GIF or WebP · up to 5 MB</span>
      </div>
      {error && (
        <span role="alert" style={{ fontSize: 11, color: "#fca5a5" }}>
          {error}
        </span>
      )}
    </div>
  );
}

const btn: CSSProperties = {
  padding: "7px 12px",
  borderRadius: 10,
  border: "1px solid rgba(148,163,184,0.4)",
  background: "rgba(15,23,42,0.6)",
  color: "#e5e7eb",
  fontSize: 12,
  fontWeight: 700,
  cursor: "pointer",
};
const linkBtn: CSSProperties = {
  background: "none",
  border: "none",
  color: "#93c5fd",
  fontSize: 12,
  cursor: "pointer",
  padding: 0,
};
