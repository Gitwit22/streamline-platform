import { useEffect, useState } from "react";

/**
 * Public room customization data (safe subset returned by
 * GET /api/rooms/:roomId/customization/public).
 *
 * This type is intentionally narrower than the full RoomCustomizationConfig
 * so we never accidentally render host-only or security-sensitive fields on
 * guest-facing pages.
 */
export type PublicRoomCustomization = {
  banner?: {
    enabled?: boolean;
    url?: string;
    position?: "top" | "bottom";
    height?: number;
    opacity?: number;
  };
  roomBackground?: {
    enabled?: boolean;
    type?: "image" | "gradient" | "solid";
    url?: string;
    value?: string;
    overlayOpacity?: number;
  };
  placeholderMedia?: {
    enabled?: boolean;
    imageUrl?: string;
    title?: string;
    subtitle?: string;
  };
  greenroom?: {
    waitingRoomMessage?: string;
  };
  layoutStyle?: "default" | "speaker" | "grid" | "host-focus";
};

interface RoomBrandingLayerProps {
  /** Customization config fetched from /api/rooms/:roomId/customization/public */
  customization: PublicRoomCustomization | null;
  /** Page content rendered on top of the branded background */
  children: React.ReactNode;
  /** When true, show the offline placeholder image instead of the background */
  showPlaceholder?: boolean;
}

/**
 * RoomBrandingLayer — applies room customization visuals (background, banner)
 * as a safe wrapper around page content.
 *
 * Safety rules:
 * - Any image that fails to load is silently replaced with the default dark background.
 * - Missing or null customization renders the default theme with no errors.
 * - This component never controls admission, routing, or lifecycle.
 * - It is purely visual.
 */
export default function RoomBrandingLayer({
  customization,
  children,
  showPlaceholder = false,
}: RoomBrandingLayerProps) {
  // Track broken image URLs so we can fall back gracefully.
  const [bgFailed, setBgFailed] = useState(false);
  const [bannerFailed, setBannerFailed] = useState(false);

  // Reset failure state when URL changes.
  const bgUrl = customization?.roomBackground?.url;
  const bannerUrl = customization?.banner?.url;

  useEffect(() => { setBgFailed(false); }, [bgUrl]);
  useEffect(() => { setBannerFailed(false); }, [bannerUrl]);

  // ── Background computation ────────────────────────────────────────────
  const bg = customization?.roomBackground;
  let backgroundStyle: React.CSSProperties = { background: "#0a0a0f" }; // default dark

  if (bg?.enabled && !bgFailed) {
    if (bg.type === "image" && bg.url) {
      backgroundStyle = {
        backgroundImage: `url(${CSS.escape ? CSS.escape(bg.url) : bg.url})`,
        backgroundSize: "cover",
        backgroundPosition: "center",
        backgroundRepeat: "no-repeat",
      };
    } else if (bg.type === "gradient" && bg.value) {
      backgroundStyle = { background: bg.value };
    } else if (bg.type === "solid" && bg.value) {
      backgroundStyle = { background: bg.value };
    }
  }

  // Overlay opacity for image backgrounds.
  const overlayOpacity =
    bg?.enabled && bg.type === "image" && !bgFailed
      ? (typeof bg.overlayOpacity === "number" ? bg.overlayOpacity : 0)
      : 0;

  // ── Banner ────────────────────────────────────────────────────────────
  const banner = customization?.banner;
  const showBanner = banner?.enabled && banner?.url && !bannerFailed;
  const bannerHeight = Math.max(20, Math.min(Number(banner?.height) || 80, 300));
  const bannerOpacity = typeof banner?.opacity === "number"
    ? Math.max(0, Math.min(1, banner.opacity))
    : 1;
  const bannerPosition = banner?.position === "top" ? "top" : "bottom";

  // ── Placeholder ───────────────────────────────────────────────────────
  const placeholder = customization?.placeholderMedia;
  const showPlaceholderImg = showPlaceholder && placeholder?.enabled && placeholder?.imageUrl;

  return (
    <div
      style={{
        minHeight: "100vh",
        position: "relative",
        ...backgroundStyle,
        color: "#fff",
        fontFamily: "'Inter', system-ui, sans-serif",
      }}
    >
      {/* Hidden img element to detect broken background URLs */}
      {bg?.enabled && bg?.type === "image" && bg?.url && !bgFailed && (
        <img
          src={bg.url}
          alt=""
          aria-hidden
          style={{ display: "none" }}
          onError={() => setBgFailed(true)}
        />
      )}

      {/* Dark overlay for image backgrounds */}
      {overlayOpacity > 0 && (
        <div
          aria-hidden
          style={{
            position: "absolute",
            inset: 0,
            background: `rgba(0,0,0,${overlayOpacity})`,
            pointerEvents: "none",
            zIndex: 0,
          }}
        />
      )}

      {/* Top banner */}
      {showBanner && bannerPosition === "top" && (
        <div
          style={{
            position: "relative",
            zIndex: 10,
            width: "100%",
            height: bannerHeight,
            overflow: "hidden",
          }}
        >
          <img
            src={banner!.url}
            alt="Room banner"
            style={{ width: "100%", height: "100%", objectFit: "cover", opacity: bannerOpacity }}
            onError={() => setBannerFailed(true)}
          />
        </div>
      )}

      {/* Placeholder image (shown when room is offline/idle) */}
      {showPlaceholderImg && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(0,0,0,0.6)",
            padding: 24,
          }}
        >
          <PlaceholderImage
            url={placeholder!.imageUrl!}
            title={placeholder!.title}
            subtitle={placeholder!.subtitle}
          />
        </div>
      )}

      {/* Page content */}
      <div style={{ position: "relative", zIndex: 5 }}>
        {children}
      </div>

      {/* Bottom banner */}
      {showBanner && bannerPosition === "bottom" && (
        <div
          style={{
            position: "fixed",
            bottom: 0,
            left: 0,
            right: 0,
            zIndex: 10,
            height: bannerHeight,
            overflow: "hidden",
          }}
        >
          <img
            src={banner!.url}
            alt="Room banner"
            style={{ width: "100%", height: "100%", objectFit: "cover", opacity: bannerOpacity }}
            onError={() => setBannerFailed(true)}
          />
        </div>
      )}
    </div>
  );
}

// ── PlaceholderImage ────────────────────────────────────────────────────────

interface PlaceholderImageProps {
  url: string;
  title?: string;
  subtitle?: string;
}

function PlaceholderImage({ url, title, subtitle }: PlaceholderImageProps) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    // Silently degrade — show title/subtitle text only.
    return (
      <div style={{ textAlign: "center" }}>
        {title && <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>{title}</div>}
        {subtitle && <div style={{ fontSize: 14, opacity: 0.7 }}>{subtitle}</div>}
      </div>
    );
  }

  return (
    <div style={{ textAlign: "center", maxWidth: 600 }}>
      <img
        src={url}
        alt={title || "Room placeholder"}
        style={{ maxWidth: "100%", maxHeight: "50vh", objectFit: "contain", borderRadius: 8 }}
        onError={() => setFailed(true)}
      />
      {title && (
        <div style={{ marginTop: 16, fontSize: 22, fontWeight: 700 }}>{title}</div>
      )}
      {subtitle && (
        <div style={{ marginTop: 6, fontSize: 14, opacity: 0.7 }}>{subtitle}</div>
      )}
    </div>
  );
}
