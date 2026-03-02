import { useEffect, useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { API_BASE } from "../../lib/apiBase";

type ResolveResponse = {
  roomId?: string;
  roomName: string;
  role: string;
  requiresAuth: boolean;
};

type AcceptResponse = {
  roomId?: string;
  roomName: string;
  role: string;
  requiresAuth: boolean;
};

async function postJson<T>(url: string, body: any, withCreds: boolean): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: withCreds ? "include" : "omit",
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
        // Canonicalize legacy JWT invites into the Firestore-backed invite flow.
        // This makes guest joins resilient to link rewriting and removes query-token reliance.
        const legacy = await postJson<{ inviteId: string; url?: string; role?: string }>(
          `${API_BASE}/api/invites/legacy/resolve`,
          { inviteToken },
          false,
        );
        if (cancelled) return;

        const inviteId = String((legacy as any)?.inviteId || "").trim();
        if (!inviteId) throw new Error("invalid_invite");

        nav(`/invite/${encodeURIComponent(inviteId)}`, { replace: true });
      } catch (e: any) {
        if (cancelled) return;
        setStatus("error");
        setErrorMsg(e?.message || "Invalid invite");
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [inviteToken, nav]);

  if (status === "error") {
    return (
      <div style={{ minHeight: "100vh", background: "#000", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
        <div style={{ maxWidth: 520, width: "100%", textAlign: "center" }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 12 }}>Invite Link Error</h1>
          <p style={{ color: "#9ca3af", marginBottom: 16 }}>{errorMsg}</p>
          <Link to="/join" style={{ color: "#ef4444", textDecoration: "none", fontWeight: 600 }}>Go to Join</Link>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: "#000", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div style={{ maxWidth: 520, width: "100%", textAlign: "center" }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 12 }}>Opening invite…</h1>
        <p style={{ color: "#9ca3af" }}>Just a moment while we connect you.</p>
      </div>
    </div>
  );
}
