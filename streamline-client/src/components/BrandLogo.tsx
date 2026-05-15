import type { CSSProperties } from "react";

type BrandLogoProps = {
  className?: string;
  width?: number | string;
  height?: number | string;
  style?: CSSProperties;
};

export default function BrandLogo({ className, width, height, style }: BrandLogoProps) {
  const resolvedStyle: CSSProperties = { ...(style || {}) };
  if (width !== undefined) {
    resolvedStyle.width = typeof width === "number" ? `${width}px` : width;
  }
  if (height !== undefined) {
    resolvedStyle.height = typeof height === "number" ? `${height}px` : height;
  }

  return (
    <img
      src="/logo_transparent.png"
      alt="StreamLine Corporate"
      className={className}
      style={resolvedStyle}
    />
  );
}