import type { CSSProperties } from "react";
import type { ProgramOverlay } from "../../lib/programOverlay";

/**
 * Draws on-video branding inside a 16:9 / 9:16 stage box, matching the
 * egress compositor: background (color + cover image) under the slots, the
 * logo above them, offset 3% of the short side from its corner.
 *
 * Render <OverlayBackground> before the slots, and <OverlayGraphics> and
 * <OverlayLogo> after them. Sizes follow the compositor: a base "label size"
 * of 3% of the short side (min 12px).
 */

function labelPx(shortSidePx: number): number {
  return Math.max(12, Math.round(shortSidePx * 0.03));
}

function bannerHeightPx(overlay: ProgramOverlay | null, shortSidePx: number): number {
  return overlay?.banner ? labelPx(shortSidePx) * 2.4 : 0;
}

export function OverlayBackground({ overlay }: { overlay: ProgramOverlay | null }) {
  const bg = overlay?.background;
  if (!bg) return null;
  return (
    <div
      data-testid="overlay-background"
      aria-hidden
      style={{ position: "absolute", inset: 0, zIndex: 0, background: bg.color || undefined, pointerEvents: "none" }}
    >
      {bg.imageUrl && (
        <img src={bg.imageUrl} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
      )}
    </div>
  );
}

export function OverlayLogo({ overlay, shortSidePx }: { overlay: ProgramOverlay | null; shortSidePx: number }) {
  const logo = overlay?.logo;
  if (!logo) return null;
  const margin = Math.round(shortSidePx * 0.03);
  const bottom = margin + Math.round(bannerHeightPx(overlay, shortSidePx));
  const style: CSSProperties = {
    position: "absolute",
    zIndex: 10000,
    width: `${logo.size}%`,
    height: "auto",
    opacity: logo.opacity,
    pointerEvents: "none",
    top: logo.position.startsWith("top") ? margin : undefined,
    bottom: logo.position.startsWith("bottom") ? bottom : undefined,
    left: logo.position.endsWith("left") ? margin : undefined,
    right: logo.position.endsWith("right") ? margin : undefined,
  };
  return <img data-testid="overlay-logo" data-position={logo.position} src={logo.url} alt="" style={style} />;
}

/** Lower third (above the banner) and banner strip, like the compositor. */
export function OverlayGraphics({ overlay, shortSidePx }: { overlay: ProgramOverlay | null; shortSidePx: number }) {
  const lt = overlay?.lowerThird;
  const banner = overlay?.banner;
  if (!lt && !banner) return null;
  const label = labelPx(shortSidePx);
  const bannerPx = bannerHeightPx(overlay, shortSidePx);
  const logo = overlay?.logo?.position === "bottom-left" ? overlay.logo : null;
  const marqueeSec = banner ? Math.max(8, Math.round(banner.text.length / 6) + 8) : 0;
  return (
    <>
      {banner?.scroll && <style>{"@keyframes sl-marquee{from{transform:translateX(0)}to{transform:translateX(-100%)}}"}</style>}
      {lt && (
        <div
          data-testid="overlay-lower-third"
          style={{
            position: "absolute",
            zIndex: 9500,
            left: logo ? `calc(${logo.size}% + ${Math.round(label * 2.4)}px)` : Math.round(label * 1.2),
            bottom: Math.round(bannerPx + label * 1.2),
            maxWidth: "60%",
            padding: `${label * 0.45}px ${label * 0.9}px`,
            background: "rgba(0,0,0,0.78)",
            borderLeft: `${label * 0.35}px solid ${lt.accent}`,
            borderRadius: label * 0.2,
            color: "#fff",
            pointerEvents: "none",
          }}
        >
          <div style={{ ...oneLine, fontWeight: 800, fontSize: label * 1.45, lineHeight: 1.2 }}>{lt.name}</div>
          {lt.title && <div style={{ ...oneLine, fontWeight: 500, fontSize: label, color: "#e5e5e5", lineHeight: 1.25 }}>{lt.title}</div>}
        </div>
      )}
      {banner && (
        <div
          data-testid="overlay-banner"
          data-scroll={banner.scroll ? "true" : "false"}
          style={{
            position: "absolute",
            zIndex: 9000,
            left: 0,
            right: 0,
            bottom: 0,
            height: bannerPx,
            display: "flex",
            alignItems: "center",
            overflow: "hidden",
            whiteSpace: "nowrap",
            background: "rgba(0,0,0,0.78)",
            borderTop: `${label * 0.18}px solid ${banner.accent}`,
            color: "#fff",
            fontWeight: 600,
            fontSize: label * 1.05,
            pointerEvents: "none",
          }}
        >
          <span
            style={
              banner.scroll
                ? { paddingLeft: "100%", animation: `sl-marquee ${marqueeSec}s linear infinite` }
                : { padding: `0 ${label * 0.9}px`, overflow: "hidden", textOverflow: "ellipsis" }
            }
          >
            {banner.text}
          </span>
        </div>
      )}
    </>
  );
}

const oneLine: CSSProperties = { whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" };
