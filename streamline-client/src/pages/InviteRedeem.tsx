import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { apiFetch } from "../lib/api";

export default function InviteRedeem() {
  const nav = useNavigate();
  const { inviteId } = useParams();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const run = async () => {
      try {
        const id = String(inviteId || "").trim();
        if (!id) {
          setError("Invalid invite link.");
          return;
        }

        const res = await apiFetch(`/api/invites/${encodeURIComponent(id)}/redeem`, {
          method: "POST",
          body: JSON.stringify({}),
        }, { allowNonOk: true });

        const ct = res.headers.get("content-type") || "";
        const data = ct.includes("application/json") ? await res.json() : null;

        if (!res.ok) {
          const msg = typeof data?.error === "string" ? data.error : `HTTP ${res.status}`;
          setError(msg);
          return;
        }

        const roomId = typeof data?.roomId === "string" ? data.roomId : "";
        if (!roomId) {
          setError("Invite redeemed, but missing roomId.");
          return;
        }

        nav(`/room/${encodeURIComponent(roomId)}`, { replace: true });
      } catch (err: any) {
        setError(err?.message || "Failed to redeem invite.");
      }
    };

    run();
  }, [inviteId, nav]);

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div style={{ maxWidth: 520, width: "100%", padding: 18, borderRadius: 12, border: "1px solid rgba(255,255,255,0.12)" }}>
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>
          {error ? "Invite Error" : "Joining…"}
        </div>
        <div style={{ fontSize: 13, opacity: 0.9 }}>
          {error ? error : "Validating your invite and preparing the room."}
        </div>
        {error && (
          <div style={{ marginTop: 14 }}>
            <button
              onClick={() => nav("/login")}
              style={{
                padding: "10px 12px",
                borderRadius: 10,
                border: "1px solid rgba(255,255,255,0.2)",
                background: "rgba(0,0,0,0.25)",
                color: "#fff",
                cursor: "pointer",
              }}
            >
              Sign in
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
