import React, { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../../lib/api";
import { formatLimitLabel } from "../../lib/entitlements";
import { isFeatureAvailable, isPlatformEnabled } from "../../lib/featureAvailability";

type ApiPlan = {
  id: string;
  name?: string;
  visibility?: "public" | "hidden" | "admin";
  limits?: {
    monthlyMinutesIncluded?: number;
    transcodeMinutes?: number;
    rtmpDestinationsMax?: number;
  };
  features?: {
    recording?: boolean;
    multistream?: boolean;
    canHls?: boolean;
    hls?: boolean;
  };
  caps?: {
    hlsMaxMinutesPerSession?: number | null;
  };
};

type ApiPlatformFlags = {
  hlsEnabled?: boolean;
  recordingEnabled?: boolean;
  transcodeEnabled?: boolean;
};

function canonicalPlanId(id: any): string {
  return String(id || "").trim().toLowerCase();
}

function safeNumber(value: any): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function planHlsPlanValue(plan: ApiPlan): boolean | "limited" {
  const canHls = Boolean(plan.features?.canHls ?? plan.features?.hls);
  if (!canHls) return false;

  // If the plan has an explicit cap, treat it as limited.
  const cap = plan.caps?.hlsMaxMinutesPerSession;
  if (cap !== null && cap !== undefined) return "limited";

  return true;
}

export const PricingExplainerPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<"inroom" | "streaming">("inroom");
  const [plans, setPlans] = useState<ApiPlan[]>([]);
  const [plansLoading, setPlansLoading] = useState<boolean>(false);
  const [plansError, setPlansError] = useState<string | null>(null);
  const [platformFlags, setPlatformFlags] = useState<ApiPlatformFlags>({
    hlsEnabled: true,
    recordingEnabled: true,
    transcodeEnabled: true,
  });

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        setPlansLoading(true);
        setPlansError(null);

        const res = await apiFetch("/api/plans", { cache: "no-store" });
        const data = (await res.json()) as any;
        const nextPlans = Array.isArray(data?.plans) ? (data.plans as ApiPlan[]) : [];
        const nextPlatformFlags = (data?.platformFlags || {}) as ApiPlatformFlags;

        if (!cancelled) {
          setPlans(nextPlans);
          setPlatformFlags({
            hlsEnabled: isPlatformEnabled(nextPlatformFlags.hlsEnabled),
            recordingEnabled: isPlatformEnabled(nextPlatformFlags.recordingEnabled),
            transcodeEnabled: isPlatformEnabled(nextPlatformFlags.transcodeEnabled),
          });
        }
      } catch (e: any) {
        if (!cancelled) {
          setPlansError(e?.message || "Failed to load plans");
          setPlans([]);
        }
      } finally {
        if (!cancelled) {
          setPlansLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const planRows = useMemo(() => {
    const byId = new Map<string, ApiPlan>();
    for (const p of plans) {
      byId.set(canonicalPlanId(p.id), p);
    }

    const defs: Array<{
      id: string;
      fallback: {
        plan: string;
        inRoom: string;
        streaming: string;
        recording: boolean;
        multistream: boolean;
        hls: boolean | "limited";
        highlight?: boolean;
      };
    }> = [
      { id: "free", fallback: { plan: "Free", inRoom: "Included", streaming: "Not included", recording: false, multistream: false, hls: false } },
      { id: "basic", fallback: { plan: "Basic", inRoom: "Included", streaming: "Not included", recording: false, multistream: false, hls: false } },
      { id: "starter", fallback: { plan: "Starter", inRoom: "Included", streaming: "60", recording: true, multistream: true, hls: "limited", highlight: true } },
      { id: "pro", fallback: { plan: "Pro", inRoom: "Included", streaming: "300", recording: true, multistream: true, hls: true, highlight: true } },
      { id: "enterprise", fallback: { plan: "Enterprise", inRoom: "Custom", streaming: "Custom", recording: true, multistream: true, hls: true } },
    ];

    return defs.map(({ id, fallback }) => {
      const p = byId.get(id);
      if (!p) {
        return {
          ...fallback,
          _key: id,
        };
      }

      const inRoomLimit = safeNumber(p.limits?.monthlyMinutesIncluded);
      const streamingLimit = safeNumber(p.limits?.transcodeMinutes);
      const rtmpMax = safeNumber((p.limits as any)?.rtmpDestinationsMax);
      const multistreamByLimit = rtmpMax > 1;
      const multistreamByFlag = typeof p.features?.multistream === "boolean" ? p.features.multistream : undefined;
      const planAllowsMultistream = typeof multistreamByFlag === "boolean" ? multistreamByFlag : multistreamByLimit;

      return {
        _key: id,
        plan: String(p.name || fallback.plan),
        inRoom: formatLimitLabel(inRoomLimit),
        streaming: formatLimitLabel(streamingLimit),
        recording: Boolean(p.features?.recording ?? fallback.recording),
        multistream: Boolean(planAllowsMultistream ?? fallback.multistream),
        hls: planHlsPlanValue(p),
        highlight: fallback.highlight,
      };
    });
  }, [plans]);

  const platformHlsEnabled = isPlatformEnabled(platformFlags.hlsEnabled);
  const platformRecordingEnabled = isPlatformEnabled(platformFlags.recordingEnabled);
  const platformTranscodeEnabled = isPlatformEnabled(platformFlags.transcodeEnabled);

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "linear-gradient(180deg, #0a0f1a 0%, #111827 50%, #0a0f1a 100%)",
        color: "#f1f5f9",
        fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Ambient background effects */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: "50%",
          transform: "translateX(-50%)",
          width: "120%",
          height: "600px",
          background:
            "radial-gradient(ellipse at center top, rgba(220, 38, 38, 0.08) 0%, transparent 60%)",
          pointerEvents: "none",
        }}
      />
      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          width: "100%",
          height: "400px",
          background:
            "radial-gradient(ellipse at center bottom, rgba(59, 130, 246, 0.05) 0%, transparent 60%)",
          pointerEvents: "none",
        }}
      />

      {/* Content container */}
      <div
        style={{
          position: "relative",
          zIndex: 1,
          maxWidth: "900px",
          margin: "0 auto",
          padding: "4rem 1.5rem",
        }}
      >
        {/* Header */}
        <header style={{ textAlign: "center", marginBottom: "4rem" }}>
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "0.5rem",
              padding: "0.4rem 1rem",
              background: "rgba(220, 38, 38, 0.1)",
              border: "1px solid rgba(220, 38, 38, 0.2)",
              borderRadius: "9999px",
              fontSize: "0.75rem",
              fontWeight: 500,
              color: "#f87171",
              marginBottom: "1.5rem",
              letterSpacing: "0.025em",
            }}
          >
            <span style={{ fontSize: "0.875rem" }}>📊</span>
            PRICING GUIDE
          </div>

          <h1
            style={{
              fontSize: "clamp(2rem, 5vw, 3rem)",
              fontWeight: 700,
              lineHeight: 1.1,
              marginBottom: "1rem",
              background: "linear-gradient(135deg, #ffffff 0%, #94a3b8 100%)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
            }}
          >
            How Minutes Work on StreamLine
          </h1>

          <p
            style={{
              fontSize: "1.125rem",
              color: "#94a3b8",
              maxWidth: "560px",
              margin: "0 auto",
              lineHeight: 1.6,
            }}
          >
            Two simple types of minutes so you always know what you're using and why.
            <br />
            <span style={{ color: "#f87171", fontWeight: 500 }}>
              No hidden math. No surprises.
            </span>
          </p>
        </header>

        {/* Tab selector */}
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            gap: "0.5rem",
            marginBottom: "2.5rem",
          }}
        >
          <TabButton
            active={activeTab === "inroom"}
            onClick={() => setActiveTab("inroom")}
            icon="🎙️"
            label="In-Room Minutes"
          />
          <TabButton
            active={activeTab === "streaming"}
            onClick={() => setActiveTab("streaming")}
            icon="📡"
            label="Broadcast Minutes"
          />
        </div>

        {/* Tab content */}
        <div
          style={{
            background: "rgba(15, 23, 42, 0.6)",
            border: "1px solid rgba(148, 163, 184, 0.1)",
            borderRadius: "1.25rem",
            padding: "2rem",
            backdropFilter: "blur(20px)",
            marginBottom: "3rem",
          }}
        >
          {activeTab === "inroom" ? <InRoomContent /> : <StreamingContent />}
        </div>

        {/* How they work together */}
        <section style={{ marginBottom: "3rem" }}>
          <SectionHeader icon="🔗" title="How Minutes Work Together" />
          <div
            style={{
              background: "linear-gradient(135deg, rgba(220, 38, 38, 0.08) 0%, rgba(59, 130, 246, 0.08) 100%)",
              border: "1px solid rgba(148, 163, 184, 0.15)",
              borderRadius: "1rem",
              padding: "1.5rem",
            }}
          >
            <p style={{ color: "#cbd5e1", lineHeight: 1.7, marginBottom: "1rem" }}>
              When you stream to external platforms:
            </p>
            <ul style={{ margin: 0, paddingLeft: "1.25rem", color: "#94a3b8", lineHeight: 1.8 }}>
              <li>
                <strong style={{ color: "#f1f5f9" }}>In-Room Minutes</strong> and{" "}
                <strong style={{ color: "#f1f5f9" }}>Broadcast Minutes</strong> are used at
                the same time
              </li>
              <li>They are tracked separately</li>
              <li>One does not replace the other</li>
            </ul>
            <div
              style={{
                marginTop: "1rem",
                padding: "0.75rem 1rem",
                background: "rgba(34, 197, 94, 0.1)",
                border: "1px solid rgba(34, 197, 94, 0.2)",
                borderRadius: "0.5rem",
                fontSize: "0.875rem",
                color: "#86efac",
              }}
            >
              ✓ This keeps usage fair and predictable.
            </div>
          </div>
        </section>

        {/* Plan comparison table */}
        <section style={{ marginBottom: "3rem" }}>
          <SectionHeader icon="📋" title="Which Plans Include Broadcast & HLS?" />
          <div
            style={{
              overflowX: "auto",
              borderRadius: "1rem",
              border: "1px solid rgba(148, 163, 184, 0.1)",
            }}
          >
            {(!platformRecordingEnabled || !platformHlsEnabled || !platformTranscodeEnabled) && !plansLoading && (
              <div
                style={{
                  padding: "0.75rem 1rem",
                  background: "rgba(15, 23, 42, 0.8)",
                  borderBottom: "1px solid rgba(148, 163, 184, 0.1)",
                  color: "#fbbf24",
                  fontSize: "0.875rem",
                }}
              >
                Some features are temporarily unavailable platform-wide.
              </div>
            )}
            {(plansLoading || plansError) && (
              <div
                style={{
                  padding: "0.75rem 1rem",
                  background: "rgba(15, 23, 42, 0.8)",
                  borderBottom: "1px solid rgba(148, 163, 184, 0.1)",
                  color: plansError ? "#fca5a5" : "#94a3b8",
                  fontSize: "0.875rem",
                }}
              >
                {plansLoading ? "Loading latest plan details…" : `Showing defaults (plans unavailable): ${plansError}`}
              </div>
            )}
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                fontSize: "0.875rem",
              }}
            >
              <thead>
                <tr style={{ background: "rgba(30, 41, 59, 0.8)" }}>
                  <Th>Plan</Th>
                  <Th>In-Room Minutes</Th>
                  {platformTranscodeEnabled !== false && <Th>Broadcast Minutes</Th>}
                  {platformRecordingEnabled !== false && <Th>Recording</Th>}
                  {platformTranscodeEnabled !== false && <Th>Multistream</Th>}
                  {platformHlsEnabled !== false && <Th>HLS</Th>}
                </tr>
              </thead>
              <tbody>
                {planRows.map((r) => (
                  <PlanRow
                    key={r._key}
                    plan={r.plan}
                    inRoom={r.inRoom}
                    streaming={r.streaming}
                    recording={r.recording}
                    multistream={r.multistream}
                    hls={r.hls}
                    highlight={r.highlight}
                    showStreaming={platformTranscodeEnabled !== false}
                    showRecording={platformRecordingEnabled !== false}
                    showMultistream={platformTranscodeEnabled !== false}
                    showHls={platformHlsEnabled !== false}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* What happens if I run out */}
        <section style={{ marginBottom: "3rem" }}>
          <SectionHeader icon="⚠️" title="What Happens If I Run Out?" />
          <div style={{ display: "grid", gap: "1rem", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}>
            <InfoCard
              title="Starter Plan"
              accent="#f59e0b"
              items={[
                "Broadcasting pauses when minutes are used up",
                "No surprise charges",
                "Upgrade anytime to continue broadcasting",
              ]}
            />
            <InfoCard
              title="Pro Plan"
              accent="#8b5cf6"
              items={[
                "Includes generous Broadcast Minutes",
                "Additional minutes available as overages:",
                "$10 per 100 Broadcast Minutes",
                "You'll always see usage before any overage applies",
              ]}
            />
          </div>
        </section>

        {/* Why StreamLine works this way */}
        <section>
          <SectionHeader icon="💡" title="Why StreamLine Works This Way" />
          <div
            style={{
              background: "rgba(15, 23, 42, 0.5)",
              border: "1px solid rgba(148, 163, 184, 0.1)",
              borderRadius: "1rem",
              padding: "1.5rem",
            }}
          >
            <p style={{ color: "#cbd5e1", marginBottom: "1rem", lineHeight: 1.7 }}>
              This approach lets us:
            </p>
            <div
              style={{
                display: "grid",
                gap: "0.75rem",
                gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
              }}
            >
              <BenefitPill icon="💰" text="Keep entry plans affordable" />
              <BenefitPill icon="🛡️" text="Protect performance & reliability" />
              <BenefitPill icon="🎯" text="No hidden broadcast costs" />
              <BenefitPill icon="📈" text="Scale cleanly for all sizes" />
            </div>
          </div>
        </section>

        {/* Footer CTA */}
        <div style={{ textAlign: "center", marginTop: "4rem" }}>
          <p style={{ color: "#64748b", fontSize: "0.875rem", marginBottom: "1rem" }}>
            Questions about pricing?
          </p>
          <a
            href="mailto:nxtlvl@gmail.com?subject=StreamLine%20Pricing%20Question"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "0.5rem",
              padding: "0.75rem 1.5rem",
              background: "linear-gradient(135deg, #dc2626 0%, #ef4444 100%)",
              color: "#ffffff",
              fontWeight: 600,
              fontSize: "0.875rem",
              borderRadius: "0.75rem",
              textDecoration: "none",
              transition: "all 0.2s ease",
            }}
          >
            Contact Us
            <span>→</span>
          </a>
        </div>
      </div>
    </div>
  );
};

/* ─────────────────────────────────────────────────────────────────────────────
   Sub-components
   ───────────────────────────────────────────────────────────────────────────── */

const TabButton: React.FC<{
  active: boolean;
  onClick: () => void;
  icon: string;
  label: string;
}> = ({ active, onClick, icon, label }) => (
  <button
    onClick={onClick}
    style={{
      display: "flex",
      alignItems: "center",
      gap: "0.5rem",
      padding: "0.75rem 1.25rem",
      background: active ? "rgba(220, 38, 38, 0.15)" : "rgba(30, 41, 59, 0.5)",
      border: active ? "1px solid rgba(220, 38, 38, 0.4)" : "1px solid rgba(148, 163, 184, 0.15)",
      borderRadius: "0.75rem",
      color: active ? "#f87171" : "#94a3b8",
      fontWeight: 500,
      fontSize: "0.875rem",
      cursor: "pointer",
      transition: "all 0.2s ease",
    }}
  >
    <span>{icon}</span>
    {label}
  </button>
);

const SectionHeader: React.FC<{ icon: string; title: string }> = ({ icon, title }) => (
  <h2
    style={{
      display: "flex",
      alignItems: "center",
      gap: "0.625rem",
      fontSize: "1.25rem",
      fontWeight: 600,
      color: "#f1f5f9",
      marginBottom: "1rem",
    }}
  >
    <span>{icon}</span>
    {title}
  </h2>
);

const InRoomContent: React.FC = () => (
  <div>
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.75rem",
        marginBottom: "1.25rem",
      }}
    >
      <div
        style={{
          width: "48px",
          height: "48px",
          borderRadius: "12px",
          background: "linear-gradient(135deg, #dc2626 0%, #f87171 100%)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: "1.5rem",
        }}
      >
        🎙️
      </div>
      <div>
        <h3 style={{ fontSize: "1.25rem", fontWeight: 600, color: "#f1f5f9", margin: 0 }}>
          In-Room Minutes
        </h3>
        <p style={{ fontSize: "0.875rem", color: "#94a3b8", margin: 0 }}>
          Your live session time
        </p>
      </div>
    </div>

    <p style={{ color: "#cbd5e1", lineHeight: 1.7, marginBottom: "1.25rem" }}>
      In-Room Minutes are used when you're live inside a StreamLine room with guests.
    </p>

    <div style={{ marginBottom: "1.5rem" }}>
      <p style={{ color: "#94a3b8", fontSize: "0.875rem", marginBottom: "0.5rem", fontWeight: 500 }}>
        This includes:
      </p>
      <ul style={{ margin: 0, paddingLeft: "1.25rem", color: "#cbd5e1", lineHeight: 1.8 }}>
        <li>Hosting a live session</li>
        <li>Bringing guests on stage</li>
        <li>Talking, collaborating, or recording inside the room</li>
      </ul>
    </div>

    <div
      style={{
        background: "rgba(59, 130, 246, 0.1)",
        border: "1px solid rgba(59, 130, 246, 0.2)",
        borderRadius: "0.75rem",
        padding: "1rem 1.25rem",
        marginBottom: "1.25rem",
      }}
    >
      <p style={{ color: "#93c5fd", fontSize: "0.875rem", margin: 0, fontStyle: "italic" }}>
        💭 Think of this as: "How long can I be live with people in my room?"
      </p>
    </div>

    <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
      <Checkmark text="Generous on paid plans" />
      <Checkmark text="Used whether or not you stream to the outside world" />
      <Checkmark text="Designed so you don't have to constantly watch the clock" />
    </div>
  </div>
);

const StreamingContent: React.FC = () => (
  <div>
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.75rem",
        marginBottom: "1.25rem",
      }}
    >
      <div
        style={{
          width: "48px",
          height: "48px",
          borderRadius: "12px",
          background: "linear-gradient(135deg, #8b5cf6 0%, #a78bfa 100%)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: "1.5rem",
        }}
      >
        📡
      </div>
      <div>
        <h3 style={{ fontSize: "1.25rem", fontWeight: 600, color: "#f1f5f9", margin: 0 }}>
          Broadcast Minutes
        </h3>
        <p style={{ fontSize: "0.875rem", color: "#94a3b8", margin: 0 }}>
          Broadcasting outside StreamLine
        </p>
      </div>
    </div>

    <p style={{ color: "#cbd5e1", lineHeight: 1.7, marginBottom: "1.25rem" }}>
      Broadcast Minutes are used when you broadcast your stream outside the room, such as:
    </p>

    <ul style={{ margin: 0, paddingLeft: "1.25rem", color: "#cbd5e1", lineHeight: 1.8, marginBottom: "1.25rem" }}>
      <li>Streaming to YouTube, Facebook, or other platforms</li>
      <li>Broadcasting via HLS to a viewer link or embedded player</li>
    </ul>

    <div
      style={{
        background: "rgba(139, 92, 246, 0.1)",
        border: "1px solid rgba(139, 92, 246, 0.2)",
        borderRadius: "0.75rem",
        padding: "1rem 1.25rem",
        marginBottom: "1.5rem",
      }}
    >
      <p style={{ color: "#c4b5fd", fontSize: "0.875rem", margin: 0, fontStyle: "italic" }}>
        💭 Think of this as: "How long can I broadcast to an audience outside StreamLine?"
      </p>
    </div>

    <h4 style={{ fontSize: "1rem", fontWeight: 600, color: "#f1f5f9", marginBottom: "1rem" }}>
      How Broadcast Minutes are counted
    </h4>

    <div style={{ display: "grid", gap: "1rem", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}>
      <div
        style={{
          background: "rgba(30, 41, 59, 0.5)",
          borderRadius: "0.75rem",
          padding: "1rem",
          border: "1px solid rgba(148, 163, 184, 0.1)",
        }}
      >
        <h5 style={{ fontSize: "0.875rem", fontWeight: 600, color: "#22d3ee", marginBottom: "0.5rem" }}>
          HLS (Viewer Link / Embed)
        </h5>
        <ul style={{ margin: 0, paddingLeft: "1rem", color: "#94a3b8", fontSize: "0.8125rem", lineHeight: 1.7 }}>
          <li>Uses 1 Broadcast minute per minute</li>
          <li>Does not increase based on viewers</li>
          <li style={{ color: "#cbd5e1" }}>
            <strong>1 hour of HLS = 60 minutes</strong>
          </li>
        </ul>
      </div>

      <div
        style={{
          background: "rgba(30, 41, 59, 0.5)",
          borderRadius: "0.75rem",
          padding: "1rem",
          border: "1px solid rgba(148, 163, 184, 0.1)",
        }}
      >
        <h5 style={{ fontSize: "0.875rem", fontWeight: 600, color: "#fb923c", marginBottom: "0.5rem" }}>
          Social Streaming
        </h5>
        <ul style={{ margin: 0, paddingLeft: "1rem", color: "#94a3b8", fontSize: "0.8125rem", lineHeight: 1.7 }}>
          <li>Uses minutes per destination</li>
          <li>1 hr to 2 platforms = 120 min</li>
          <li>1 hr to 3 platforms = 180 min</li>
        </ul>
      </div>
    </div>
  </div>
);

const Checkmark: React.FC<{ text: string }> = ({ text }) => (
  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", color: "#86efac", fontSize: "0.875rem" }}>
    <span>✓</span>
    <span style={{ color: "#cbd5e1" }}>{text}</span>
  </div>
);

const Th: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <th
    style={{
      padding: "0.875rem 1rem",
      textAlign: "left",
      fontWeight: 600,
      color: "#94a3b8",
      fontSize: "0.75rem",
      textTransform: "uppercase",
      letterSpacing: "0.05em",
      borderBottom: "1px solid rgba(148, 163, 184, 0.1)",
    }}
  >
    {children}
  </th>
);

const PlanRow: React.FC<{
  plan: string;
  inRoom: string;
  streaming: string;
  recording: boolean;
  multistream: boolean;
  hls: boolean | "limited";
  highlight?: boolean;
  showStreaming: boolean;
  showRecording: boolean;
  showMultistream: boolean;
  showHls: boolean;
}> = ({ plan, inRoom, streaming, recording, multistream, hls, highlight, showStreaming, showRecording, showMultistream, showHls }) => (
  <tr
    style={{
      background: highlight ? "rgba(220, 38, 38, 0.05)" : "transparent",
      borderBottom: "1px solid rgba(148, 163, 184, 0.08)",
    }}
  >
    <td style={{ padding: "0.875rem 1rem", fontWeight: 600, color: "#f1f5f9" }}>{plan}</td>
    <td style={{ padding: "0.875rem 1rem", color: "#94a3b8" }}>{inRoom}</td>
    {showStreaming && (
      <td style={{ padding: "0.875rem 1rem", color: streaming === "Not included" ? "#64748b" : "#94a3b8" }}>
        {streaming}
      </td>
    )}
    {showRecording && (
      <td style={{ padding: "0.875rem 1rem" }}>
        {recording ? (
          <span style={{ color: "#22c55e" }}>✅</span>
        ) : (
          <div style={{ color: "#64748b", lineHeight: 1.15 }}>
            <div>🔒</div>
            <div style={{ fontSize: "0.75rem", marginTop: 4 }}>Not included in this plan</div>
          </div>
        )}
      </td>
    )}
    {showMultistream && (
      <td style={{ padding: "0.875rem 1rem" }}>
        {multistream ? (
          <span style={{ color: "#22c55e" }}>✅</span>
        ) : (
          <div style={{ color: "#64748b", lineHeight: 1.15 }}>
            <div>🔒</div>
            <div style={{ fontSize: "0.75rem", marginTop: 4 }}>Not included in this plan</div>
          </div>
        )}
      </td>
    )}
    {showHls && (
      <td style={{ padding: "0.875rem 1rem" }}>
        {hls === true && <span style={{ color: "#22c55e" }}>✅</span>}
        {hls === false && (
          <div style={{ color: "#64748b", lineHeight: 1.15 }}>
            <div>🔒</div>
            <div style={{ fontSize: "0.75rem", marginTop: 4 }}>Not included in this plan</div>
          </div>
        )}
        {hls === "limited" && <span style={{ color: "#f59e0b", fontSize: "0.75rem" }}>✅ limited</span>}
      </td>
    )}
  </tr>
);

const InfoCard: React.FC<{
  title: string;
  accent: string;
  items: string[];
}> = ({ title, accent, items }) => (
  <div
    style={{
      background: "rgba(15, 23, 42, 0.6)",
      border: `1px solid ${accent}33`,
      borderRadius: "1rem",
      padding: "1.25rem",
      borderTop: `3px solid ${accent}`,
    }}
  >
    <h4 style={{ fontSize: "1rem", fontWeight: 600, color: accent, marginBottom: "0.75rem" }}>
      {title}
    </h4>
    <ul style={{ margin: 0, paddingLeft: "1.1rem", color: "#94a3b8", fontSize: "0.875rem", lineHeight: 1.8 }}>
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  </div>
);

const BenefitPill: React.FC<{ icon: string; text: string }> = ({ icon, text }) => (
  <div
    style={{
      display: "flex",
      alignItems: "center",
      gap: "0.5rem",
      padding: "0.625rem 0.875rem",
      background: "rgba(30, 41, 59, 0.6)",
      borderRadius: "0.5rem",
      border: "1px solid rgba(148, 163, 184, 0.1)",
      fontSize: "0.8125rem",
      color: "#cbd5e1",
    }}
  >
    <span>{icon}</span>
    {text}
  </div>
);

export default PricingExplainerPage;
