import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { API_BASE } from "../../lib/apiBase";

async function postJson<T>(url: string, body: any): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "omit",
    body: JSON.stringify(body),
  });
  const ct = res.headers.get("content-type") || "";
  const data = ct.includes("application/json") ? await res.json().catch(() => ({})) : await res.text().catch(() => "");
  if (!res.ok) {
    const err = typeof data === "object" && data ? (data as any).error : String(data || "request_failed");
    throw new Error(err);
  }
  return data as T;
}

export default function InviteLanding() {
  const nav = useNavigate();
  const { inviteToken } = useParams<{ inviteToken: string }>();
  const [status, setStatus] = useState<"loading" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState<string>("");

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      if (!inviteToken) {
        nav("/join", { replace: true });
        return;
      }

      try {
        const legacy = await postJson<{ inviteId: string }>(
          `${API_BASE}/api/invites/legacy/resolve`,
          { inviteToken },
        );
        if (cancelled) return;

        const inviteId = String(legacy?.inviteId || "").trim();
        if (!inviteId) throw new Error("invalid_invite");

        nav(`/invite/${encodeURIComponent(inviteId)}`, { replace: true });
      } catch (e: any) {
        if (cancelled) return;
        setStatus("error");
        setErrorMsg(e?.message || "Invalid invite");
      }
    };

    run();
    return () => { cancelled = true; };
  }, [inviteToken, nav]);

  const wrap: React.CSSProperties = {
    minHeight: "100vh", background: "#0a0a0f", color: "#fff",
    display: "flex", alignItems: "center", justifyContent: "center",
    padding: 24, fontFamily: "'Inter', system-ui, sans-serif",
  };

  const card: React.CSSProperties = {
    maxWidth: 440, width: "100%", padding: 32, borderRadius: 16,
    border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.04)",
    textAlign: "center",
  };

  if (status === "error") {
    return (
      <div style={wrap}>
        <div style={card}>
          <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Invite Link Error</div>
          <div style={{ fontSize: 14, opacity: 0.7, marginBottom: 20 }}>{errorMsg}</div>
          <button
            onClick={() => nav("/join")}
            style={{
              padding: "10px 20px", borderRadius: 10,
              border: "1px solid rgba(255,255,255,0.15)", background: "rgba(255,255,255,0.06)",
              color: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer",
            }}
          >
            Go to Join
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={wrap}>
      <div style={card}>
        <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Opening invite…</div>
        <div style={{ fontSize: 14, opacity: 0.6 }}>Just a moment while we connect you.</div>
      </div>
    </div>
  );
}
