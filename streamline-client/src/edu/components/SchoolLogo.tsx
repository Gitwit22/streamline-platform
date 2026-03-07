/**
 * SchoolLogo — reusable school-branded logo component.
 *
 * Shows the school's uploaded logo when available, otherwise renders a
 * gradient-initial fallback.  Pulls branding from context (authenticated
 * pages) OR accepts explicit props (public pages).
 *
 * Cache-busting is handled by the branding context.
 */

import { useSchoolBranding } from "../state/schoolBranding";

type Size = "xs" | "sm" | "md" | "lg" | "xl";

const SIZE_MAP: Record<Size, { box: string; text: string; img: string }> = {
  xs: { box: "h-6 w-6", text: "text-[10px]", img: "h-6 w-6" },
  sm: { box: "h-8 w-8", text: "text-xs", img: "h-8 w-8" },
  md: { box: "h-10 w-10", text: "text-sm", img: "h-10 w-10" },
  lg: { box: "h-12 w-12", text: "text-base", img: "h-12 w-12" },
  xl: { box: "h-20 w-20", text: "text-2xl", img: "h-20 w-20" },
};

type Props = {
  /** Override size. Default "md" */
  size?: Size;
  /** If provided, use this URL instead of branding context.  Useful for public pages. */
  logoUrl?: string | null;
  /** Fallback school name for the initial. */
  schoolName?: string | null;
  /** Extra Tailwind classes on the outer wrapper */
  className?: string;
  /** border-radius style override (defaults to rounded-xl) */
  rounded?: string;
};

export default function SchoolLogo({
  size = "md",
  logoUrl: propLogoUrl,
  schoolName: propSchoolName,
  className = "",
  rounded = "rounded-xl",
}: Props) {
  // Try to pull from context; fall back to props.
  let ctxLogoUrl: string | null = null;
  let ctxSchoolName: string = "S";
  try {
    // This may throw if component is outside provider — that's fine.
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const { branding } = useSchoolBranding();
    ctxLogoUrl = branding.logoUrl;
    ctxSchoolName = branding.schoolName;
  } catch {
    // outside of provider — use props only
  }

  const logoUrl = propLogoUrl ?? ctxLogoUrl;
  const schoolName = propSchoolName ?? ctxSchoolName ?? "S";
  const s = SIZE_MAP[size] || SIZE_MAP.md;

  if (logoUrl) {
    return (
      <div className={`${s.box} overflow-hidden ${rounded} border border-slate-700/60 bg-slate-950/40 flex-shrink-0 ${className}`}>
        <img
          src={logoUrl}
          alt={`${schoolName} logo`}
          className={`${s.img} object-contain`}
          loading="eager"
          decoding="async"
        />
      </div>
    );
  }

  // Gradient initial fallback
  const initial = schoolName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("") || "S";

  return (
    <div
      className={`${s.box} flex items-center justify-center ${rounded} bg-gradient-to-br from-orange-500 to-red-600 ${s.text} font-bold text-white flex-shrink-0 ${className}`}
      aria-label={`${schoolName} logo`}
    >
      {initial}
    </div>
  );
}
