import { ReactNode, useEffect, useState } from "react";

interface CollapsibleSectionProps {
  id: string;
  title: string;
  rightBadge?: ReactNode;
  defaultOpen?: boolean;
  onToggle?: (open: boolean) => void;
  children: ReactNode;
}

export default function CollapsibleSection({
  id,
  title,
  rightBadge,
  defaultOpen = false,
  onToggle,
  children,
}: CollapsibleSectionProps) {
  const [open, setOpen] = useState<boolean>(defaultOpen);

  // Keep internal state in sync with persisted default when it changes
  useEffect(() => {
    setOpen(defaultOpen);
  }, [defaultOpen]);

  const handleToggle = () => {
    const next = !open;
    setOpen(next);
    if (onToggle) onToggle(next);
  };

  return (
    <section
      data-section-id={id}
      style={{
        borderRadius: "0.5rem",
        border: "1px solid rgba(31,41,55,0.9)",
        background: "rgba(15,23,42,0.9)",
        boxShadow: "0 12px 30px rgba(0,0,0,0.35)",
        overflow: "hidden",
      }}
    >
      <button
        type="button"
        onClick={handleToggle}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0.6rem 0.8rem",
          background: "rgba(15,23,42,0.95)",
          border: "none",
          cursor: "pointer",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
          }}
        >
          <span
            aria-hidden="true"
            style={{
              display: "inline-block",
              transform: open ? "rotate(90deg)" : "rotate(0deg)",
              transition: "transform 0.18s ease-out",
              fontSize: "0.8rem",
              color: "#9ca3af",
            }}
          >
            ▶
          </span>
          <span
            style={{
              fontSize: "0.8rem",
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              color: "#e5e7eb",
            }}
          >
            {title}
          </span>
        </div>
        {rightBadge && (
          <div
            style={{
              marginLeft: "0.5rem",
              display: "flex",
              alignItems: "center",
            }}
          >
            {rightBadge}
          </div>
        )}
      </button>
      {open && (
        <div
          style={{
            padding: "0.75rem 0.8rem 0.85rem 0.8rem",
            borderTop: "1px solid rgba(31,41,55,0.9)",
            background: "rgba(15,23,42,0.98)",
          }}
        >
          {children}
        </div>
      )}
    </section>
  );
}
