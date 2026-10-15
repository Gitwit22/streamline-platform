import type { CSSProperties } from "react";
import type { ProgramOverlay } from "../../lib/programOverlay";

/**
 * Draws on-video branding inside a 16:9 / 9:16 stage box, matching the
 * egress compositor: background (color + cover image) under the slots, the
 * logo above them, offset 3% of the short side from its corner.
 *
 * Render <OverlayBackground> before the slots and <OverlayLogo> after them.
 */
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
  const style: CSSProperties = {
    position: "absolute",
    zIndex: 10000,
    width: `${logo.size}%`,
    height: "auto",
    opacity: logo.opacity,
    pointerEvents: "none",
    top: logo.position.startsWith("top") ? margin : undefined,
    bottom: logo.position.startsWith("bottom") ? margin : undefined,
    left: logo.position.endsWith("left") ? margin : undefined,
    right: logo.position.endsWith("right") ? margin : undefined,
  };
  return <img data-testid="overlay-logo" data-position={logo.position} src={logo.url} alt="" style={style} />;
}
