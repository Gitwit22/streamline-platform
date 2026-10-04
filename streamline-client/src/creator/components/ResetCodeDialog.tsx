import React, { useState } from "react";

export type IssuedResetCode = {
  email: string;
  code: string;
  expiresAt?: number | null;
};

/**
 * Shows a one-time admin password-reset code. The server returns the code only
 * once (it stores just a hash), so the admin must copy it now and give it to the
 * user out of band. The user enters it on the Forgot Password page.
 */
export function ResetCodeDialog({ issued, onClose }: { issued: IssuedResetCode; onClose: () => void }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(issued.code);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const expires =
    typeof issued.expiresAt === "number" && issued.expiresAt > 0
      ? new Date(issued.expiresAt).toLocaleString()
      : null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="reset-code-title"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.75)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        zIndex: 1000,
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 440,
          background: "#111",
          color: "#fff",
          border: "1px solid rgba(255,255,255,0.12)",
          borderRadius: 16,
          padding: 24,
          boxShadow: "0 24px 60px rgba(0,0,0,0.5)",
        }}
      >
        <h2 id="reset-code-title" style={{ margin: 0, marginBottom: 8, fontSize: 20 }}>
          Password reset code
        </h2>
        <p style={{ margin: 0, marginBottom: 16, color: "#a3a3a3", fontSize: 14, lineHeight: 1.5 }}>
          Give this code to <strong style={{ color: "#fff" }}>{issued.email}</strong> through a channel you trust
          (not the same email if it may be compromised). They enter it on the Forgot Password page. It works once
          {expires ? <> and expires {expires}</> : null}. This is the only time it is shown.
        </p>
        <div
          style={{
            fontFamily: "monospace",
            fontSize: 26,
            letterSpacing: "0.12em",
            textAlign: "center",
            padding: "14px 12px",
            borderRadius: 12,
            background: "rgba(255,255,255,0.06)",
            border: "1px solid rgba(255,255,255,0.12)",
            userSelect: "all",
            wordBreak: "break-all",
          }}
        >
          {issued.code}
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
          <button
            type="button"
            onClick={copy}
            style={{
              flex: 1,
              padding: "10px 12px",
              borderRadius: 10,
              border: "1px solid rgba(255,255,255,0.15)",
              background: "rgba(255,255,255,0.08)",
              color: "#fff",
              cursor: "pointer",
            }}
          >
            {copied ? "Copied" : "Copy code"}
          </button>
          <button
            type="button"
            onClick={onClose}
            style={{
              flex: 1,
              padding: "10px 12px",
              borderRadius: 10,
              border: "none",
              background: "#dc2626",
              color: "#fff",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

export default ResetCodeDialog;
