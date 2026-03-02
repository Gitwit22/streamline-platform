import React from "react";

type Props = {
  message: string | null;
};

export function RoleChangeToast({ message }: Props) {
  if (!message) return null;

  return (
    <div
      style={{
        position: "fixed",
        top: "20%",
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 9999,
        pointerEvents: "none",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      <div
        style={{
          maxWidth: "90%",
          padding: "0.75rem 1.5rem",
          borderRadius: "9999px",
          background: "rgba(17, 24, 39, 0.9)",
          color: "#f9fafb",
          fontSize: "0.95rem",
          fontWeight: 600,
          boxShadow: "0 10px 25px rgba(0,0,0,0.45)",
          opacity: 1,
          transition: "opacity 0.2s ease-out, transform 0.2s ease-out",
        }}
      >
        {message}
      </div>
    </div>
  );
}
