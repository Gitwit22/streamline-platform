// src/pages/LearnMore.tsx
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { usePlatformFlags } from "../../hooks/usePlatformFlags";

/**
 * STREAMLINE LEARN MORE PAGE
 * Premium glassmorphism design with cinematic animations
 * Black/Red/White theme with depth and atmosphere
 */

type Feature = {
  icon: string;
  title: string;
  items: string[];
};

type FutureFeature = {
  icon: string;
  title: string;
  description: string;
  status: "Planned" | "Future";
};

type Audience = {
  emoji: string;
  title: string;
  desc: string;
};

export default function LearnMore() {
  const nav = useNavigate();
  const { flags: platformFlags } = usePlatformFlags();
  const platformTranscodeEnabled = platformFlags?.transcodeEnabled === true;
  const [scrollProgress, setScrollProgress] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container;
      const denom = Math.max(1, scrollHeight - clientHeight);
      const progress = Math.min(1, Math.max(0, scrollTop / denom));
      setScrollProgress(progress);
    };

    // Set initial progress in case the container isn't at top on mount
    handleScroll();

    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => container.removeEventListener("scroll", handleScroll);
  }, []);

  const features: Feature[] = [
    {
      icon: "🎥",
      title: "Live Streaming",
      items: [
        "Go live directly from your browser",
        "Host single-host or multi-participant sessions",
        "Control who can speak, share video, or just watch",
      ],
    },
    {
      icon: "🌐",
      title: "Multistreaming",
      items: [
        "Stream to multiple platforms simultaneously",
        "YouTube, Facebook, Twitch & more",
        "Centralized control hub",
      ],
    },
    {
      icon: "🌐",
      title: "HLS",
      items: [
        "Stream to a shareable link",
        "Works on websites, mobile, and TV",
        "Great for private or unlisted events",
      ],
    },
    {
      icon: "📼",
      title: "Recording",
      items: [
        "Record automatically or on demand",
        "Download after session ends",
        "Secure one-time download links",
      ],
    },
    {
      icon: "🎛",
      title: "Simple Controls",
      items: [
        "Toggle camera and microphone",
        "Start and stop streams cleanly",
        "Exit rooms to stop usage instantly",
      ],
    },
    {
      icon: "📊",
      title: "Usage-Aware",
      items: [
        "Clear limits on minutes & participants",
        "Prevent surprise overages",
        "Designed for sustainable growth",
      ],
    },
  ];

  const futureFeatures: FutureFeature[] = [
    ...(platformTranscodeEnabled
      ? ([
          {
            icon: "✂️",
            title: "AI Editing Suite",
            description: "Automatic highlights, captions, timeline editing, social exports",
            status: "Planned",
          },
        ] as FutureFeature[])
      : []),
    {
      icon: "📡",
      title: "Prerecorded Mode",
      description: "Upload shows instead of going live. Lower cost, higher limits.",
      status: "Planned",
    },
    {
      icon: "📺",
      title: "TV Experience",
      description: "Channel-style browsing for TVs and set-top platforms",
      status: "Future",
    },
    {
      icon: "🧠",
      title: "Smart Streaming",
      description: "Adaptive layouts, auto quality, session optimizations",
      status: "Future",
    },
    {
      icon: "🧾",
      title: "Advanced Analytics",
      description: "Detailed dashboards, per-room breakdowns, team management",
      status: "Future",
    },
    {
      icon: "💬",
      title: "Audience Tools",
      description: "Unified chat, moderation, polls, live reactions",
      status: "Future",
    },
  ];

  const audiences: Audience[] = [
    { emoji: "🎙️", title: "Creators & Podcasters", desc: "Run shows, interviews, live discussions" },
    { emoji: "🎓", title: "Educators & Coaches", desc: "Host classes, workshops, private sessions" },
    { emoji: "💼", title: "Businesses", desc: "Internal meetings, announcements, events" },
    { emoji: "🎉", title: "Event Hosts", desc: "Pop-up shows, parties, launches" },
  ];

  return (
    <div
      ref={containerRef}
      style={{
        minHeight: "100vh",
        backgroundColor: "#000000",
        color: "#ffffff",
        overflowY: "auto",
        overflowX: "hidden",
        position: "relative",
      }}
    >
      {/* SCROLL PROGRESS BAR */}
      <div
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          height: "3px",
          width: `${scrollProgress * 100}%`,
          background: "linear-gradient(90deg, #dc2626, #ef4444, #f87171)",
          zIndex: 100,
          transition: "width 0.1s ease-out",
        }}
      />

      {/* FIXED NAVIGATION */}
      <nav
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          zIndex: 50,
          padding: "20px 40px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          background: scrollProgress > 0.02 ? "rgba(0, 0, 0, 0.85)" : "transparent",
          backdropFilter: scrollProgress > 0.02 ? "blur(20px)" : "none",
          borderBottom: scrollProgress > 0.02 ? "1px solid rgba(255, 255, 255, 0.1)" : "none",
          transition: "all 0.3s ease",
        }}
      >
        <button
          onClick={() => nav("/")}
          style={{
            background: "none",
            border: "none",
            color: "#ffffff",
            fontSize: "14px",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: "8px",
            opacity: 0.8,
            transition: "opacity 0.3s ease",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.opacity = "1")}
          onMouseLeave={(e) => (e.currentTarget.style.opacity = "0.8")}
        >
          ← Back to Home
        </button>

        <button
          onClick={() => nav("/login")}
          style={{
            padding: "12px 28px",
            background: "linear-gradient(135deg, #dc2626, #ef4444)",
            border: "none",
            borderRadius: "8px",
            color: "#ffffff",
            fontSize: "14px",
            fontWeight: "600",
            cursor: "pointer",
            boxShadow: "0 4px 20px rgba(220, 38, 38, 0.4)",
            transition: "all 0.3s ease",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = "translateY(-2px)";
            e.currentTarget.style.boxShadow = "0 8px 30px rgba(220, 38, 38, 0.5)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = "translateY(0)";
            e.currentTarget.style.boxShadow = "0 4px 20px rgba(220, 38, 38, 0.4)";
          }}
        >
          Start Streaming
        </button>
      </nav>

      {/* ANIMATED BACKGROUND ELEMENTS */}
      <div style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 0 }}>
        {/* Primary orb (wrapper handles scroll transform, inner handles float animation) */}
        <div
          style={{
            position: "absolute",
            top: "10%",
            right: "10%",
            transform: `translateY(${scrollProgress * -200}px)`,
          }}
        >
          <div
            style={{
              width: "800px",
              height: "800px",
              background: "radial-gradient(circle, rgba(220, 38, 38, 0.15) 0%, transparent 70%)",
              borderRadius: "50%",
              filter: "blur(80px)",
              animation: "float 20s ease-in-out infinite",
            }}
          />
        </div>

        {/* Secondary orb */}
        <div
          style={{
            position: "absolute",
            bottom: "20%",
            left: "5%",
            transform: `translateY(${scrollProgress * 150}px)`,
          }}
        >
          <div
            style={{
              width: "600px",
              height: "600px",
              background: "radial-gradient(circle, rgba(239, 68, 68, 0.1) 0%, transparent 70%)",
              borderRadius: "50%",
              filter: "blur(60px)",
              animation: "float 25s ease-in-out infinite reverse",
            }}
          />
        </div>

        {/* Accent orb (wrapper keeps translate, inner pulses) */}
        <div
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
          }}
        >
          <div
            style={{
              width: "400px",
              height: "400px",
              background: "radial-gradient(circle, rgba(248, 113, 113, 0.08) 0%, transparent 70%)",
              borderRadius: "50%",
              filter: "blur(50px)",
              animation: "pulse 8s ease-in-out infinite",
              transform: `scale(${1 + scrollProgress * 0.3})`,
            }}
          />
        </div>

        {/* Grid overlay */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            backgroundImage: `
              linear-gradient(rgba(255, 255, 255, 0.02) 1px, transparent 1px),
              linear-gradient(90deg, rgba(255, 255, 255, 0.02) 1px, transparent 1px)
            `,
            backgroundSize: "60px 60px",
            opacity: 0.5,
          }}
        />
      </div>

      {/* HERO SECTION */}
      <section
        style={{
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          textAlign: "center",
          padding: "120px 40px 80px",
          position: "relative",
          zIndex: 10,
        }}
      >
        {/* Floating badge */}
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "8px",
            padding: "8px 16px",
            background: "rgba(220, 38, 38, 0.1)",
            border: "1px solid rgba(220, 38, 38, 0.3)",
            borderRadius: "100px",
            fontSize: "13px",
            color: "#f87171",
            marginBottom: "32px",
            animation: "slideDown 0.8s ease-out",
          }}
        >
          <span
            style={{
              width: "8px",
              height: "8px",
              background: "#ef4444",
              borderRadius: "50%",
              animation: "pulseDot 2s ease-in-out infinite",
            }}
          />
          Platform Overview
        </div>

        <h1
          style={{
            fontSize: "clamp(48px, 8vw, 96px)",
            fontWeight: "800",
            lineHeight: "1.05",
            marginBottom: "24px",
            background: "linear-gradient(135deg, #ffffff 0%, #fecaca 50%, #ffffff 100%)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            animation: "slideUp 0.8s ease-out 0.1s both",
            letterSpacing: "-0.03em",
          }}
        >
          What Is
          <br />
          <span
            style={{
              background: "linear-gradient(135deg, #ef4444, #dc2626)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
            }}
          >
            StreamLine?
          </span>
        </h1>

        <p
          style={{
            fontSize: "clamp(18px, 2.5vw, 24px)",
            maxWidth: "800px",
            color: "rgba(255, 255, 255, 0.7)",
            lineHeight: "1.7",
            marginBottom: "48px",
            animation: "slideUp 0.8s ease-out 0.2s both",
          }}
        >
          A modern live streaming and recording platform built for creators, educators,
          businesses, and event hosts who want{" "}
          <span style={{ color: "#f87171", fontWeight: 600 }}>professional-grade streaming</span>{" "}
          without enterprise-level complexity.
        </p>

        {/* Value props */}
        <div
          style={{
            display: "flex",
            gap: "32px",
            flexWrap: "wrap",
            justifyContent: "center",
            animation: "slideUp 0.8s ease-out 0.3s both",
          }}
        >
          {[
            { icon: "⚡", text: "Simple to start" },
            { icon: "🔄", text: "Flexible workflows" },
            { icon: "📈", text: "Scales with you" },
          ].map((item) => (
            <div
              key={item.text}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "12px",
                padding: "16px 24px",
                background: "rgba(255, 255, 255, 0.03)",
                border: "1px solid rgba(255, 255, 255, 0.08)",
                borderRadius: "12px",
                backdropFilter: "blur(10px)",
              }}
            >
              <span style={{ fontSize: "24px" }}>{item.icon}</span>
              <span style={{ fontSize: "15px", fontWeight: 500 }}>{item.text}</span>
            </div>
          ))}
        </div>

        {/* Scroll indicator */}
        <div
          style={{
            position: "absolute",
            bottom: "40px",
            left: "50%",
            transform: "translateX(-50%)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "8px",
            opacity: 0.5,
            animation: "bounce 2s ease-in-out infinite",
          }}
        >
          <span style={{ fontSize: "12px", letterSpacing: "0.1em" }}>SCROLL</span>
          <div
            style={{
              width: "1px",
              height: "40px",
              background: "linear-gradient(to bottom, #ef4444, transparent)",
            }}
          />
        </div>
      </section>

      {/* FEATURES SECTION */}
      <section style={{ padding: "120px 40px", position: "relative", zIndex: 10 }}>
        <div style={{ maxWidth: "1200px", margin: "0 auto" }}>
          <div style={{ textAlign: "center", marginBottom: "80px" }}>
            <h2
              style={{
                fontSize: "clamp(36px, 5vw, 56px)",
                fontWeight: 700,
                marginBottom: "16px",
                background: "linear-gradient(135deg, #ffffff, #fecaca)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
              }}
            >
              What You Can Do Today
            </h2>
            <p style={{ fontSize: "18px", color: "rgba(255, 255, 255, 0.6)" }}>
              Powerful features, available right now
            </p>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
              gap: "24px",
            }}
          >
            {features.map((feature) => (
              <FeatureCard key={feature.title} feature={feature} />
            ))}
          </div>
        </div>
      </section>

      {/* AUDIENCE SECTION */}
      <section style={{ padding: "120px 40px", position: "relative", zIndex: 10 }}>
        <div style={{ maxWidth: "1200px", margin: "0 auto" }}>
          <div style={{ textAlign: "center", marginBottom: "80px" }}>
            <h2
              style={{
                fontSize: "clamp(36px, 5vw, 56px)",
                fontWeight: 700,
                marginBottom: "16px",
                background: "linear-gradient(135deg, #ffffff, #fecaca)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
              }}
            >
              Built For You
            </h2>
            <p
              style={{
                fontSize: "18px",
                color: "rgba(255, 255, 255, 0.6)",
                maxWidth: "600px",
                margin: "0 auto",
              }}
            >
              If you need something more powerful than basic social streaming—but simpler than
              enterprise broadcast software—StreamLine fits that gap.
            </p>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
              gap: "20px",
            }}
          >
            {audiences.map((audience) => (
              <div
                key={audience.title}
                style={{
                  padding: "32px",
                  background:
                    "linear-gradient(135deg, rgba(220, 38, 38, 0.05), rgba(15, 15, 15, 0.8))",
                  border: "1px solid rgba(220, 38, 38, 0.2)",
                  borderRadius: "16px",
                  textAlign: "center",
                  transition: "all 0.4s ease",
                  cursor: "default",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = "translateY(-8px)";
                  e.currentTarget.style.borderColor = "rgba(220, 38, 38, 0.5)";
                  e.currentTarget.style.boxShadow = "0 20px 60px rgba(220, 38, 38, 0.15)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = "translateY(0)";
                  e.currentTarget.style.borderColor = "rgba(220, 38, 38, 0.2)";
                  e.currentTarget.style.boxShadow = "none";
                }}
              >
                <div style={{ fontSize: "48px", marginBottom: "16px" }}>{audience.emoji}</div>
                <h3 style={{ fontSize: "20px", fontWeight: 700, marginBottom: "8px" }}>
                  {audience.title}
                </h3>
                <p style={{ fontSize: "14px", color: "rgba(255, 255, 255, 0.6)" }}>
                  {audience.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FUTURE FEATURES SECTION */}
      <section
        style={{
          padding: "120px 40px",
          position: "relative",
          zIndex: 10,
          background:
            "linear-gradient(180deg, transparent 0%, rgba(220, 38, 38, 0.03) 50%, transparent 100%)",
        }}
      >
        <div style={{ maxWidth: "1200px", margin: "0 auto" }}>
          <div style={{ textAlign: "center", marginBottom: "80px" }}>
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "8px",
                padding: "8px 16px",
                background: "rgba(234, 179, 8, 0.1)",
                border: "1px solid rgba(234, 179, 8, 0.3)",
                borderRadius: "100px",
                fontSize: "12px",
                color: "#fbbf24",
                marginBottom: "24px",
                textTransform: "uppercase",
                letterSpacing: "0.1em",
              }}
            >
              <span>🚀</span> Coming Soon
            </div>
            <h2
              style={{
                fontSize: "clamp(36px, 5vw, 56px)",
                fontWeight: 700,
                marginBottom: "16px",
                background: "linear-gradient(135deg, #ffffff, #fecaca)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
              }}
            >
              Future Upgrades
            </h2>
            <p style={{ fontSize: "18px", color: "rgba(255, 255, 255, 0.6)" }}>
              StreamLine is built with expansion in mind
            </p>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))",
              gap: "20px",
            }}
          >
            {futureFeatures.map((feature) => (
              <div
                key={feature.title}
                style={{
                  padding: "28px",
                  background: "rgba(15, 15, 15, 0.6)",
                  border: "1px solid rgba(255, 255, 255, 0.08)",
                  borderRadius: "16px",
                  display: "flex",
                  gap: "20px",
                  alignItems: "flex-start",
                  transition: "all 0.3s ease",
                  backdropFilter: "blur(10px)",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = "rgba(255, 255, 255, 0.15)";
                  e.currentTarget.style.background = "rgba(20, 20, 20, 0.8)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = "rgba(255, 255, 255, 0.08)";
                  e.currentTarget.style.background = "rgba(15, 15, 15, 0.6)";
                }}
              >
                <div
                  style={{
                    width: "56px",
                    height: "56px",
                    borderRadius: "12px",
                    background: "rgba(220, 38, 38, 0.1)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "28px",
                    flexShrink: 0,
                  }}
                >
                  {feature.icon}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "8px" }}>
                    <h3 style={{ fontSize: "18px", fontWeight: 700 }}>{feature.title}</h3>
                    <span
                      style={{
                        padding: "4px 10px",
                        background:
                          feature.status === "Planned"
                            ? "rgba(34, 197, 94, 0.15)"
                            : "rgba(59, 130, 246, 0.15)",
                        color: feature.status === "Planned" ? "#4ade80" : "#60a5fa",
                        borderRadius: "6px",
                        fontSize: "11px",
                        fontWeight: 600,
                        textTransform: "uppercase",
                        letterSpacing: "0.05em",
                      }}
                    >
                      {feature.status}
                    </span>
                  </div>
                  <p style={{ fontSize: "14px", color: "rgba(255, 255, 255, 0.6)", lineHeight: "1.6" }}>
                    {feature.description}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* PHILOSOPHY SECTION */}
      <section style={{ padding: "120px 40px", position: "relative", zIndex: 10 }}>
        <div style={{ maxWidth: "900px", margin: "0 auto", textAlign: "center" }}>
          <h2
            style={{
              fontSize: "clamp(36px, 5vw, 56px)",
              fontWeight: 700,
              marginBottom: "40px",
              background: "linear-gradient(135deg, #ffffff, #fecaca)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
            }}
          >
            Built for the Long Game
          </h2>

          <div
            style={{
              background: "rgba(15, 15, 15, 0.6)",
              border: "1px solid rgba(220, 38, 38, 0.2)",
              borderRadius: "24px",
              padding: "48px",
              backdropFilter: "blur(20px)",
            }}
          >
            <p
              style={{
                fontSize: "20px",
                color: "rgba(255, 255, 255, 0.8)",
                lineHeight: "1.8",
                marginBottom: "40px",
              }}
            >
              StreamLine is not just a tool—it's a{" "}
              <span style={{ color: "#f87171", fontWeight: 600 }}>platform</span>. Every feature is
              designed to scale with your audience, respect real infrastructure costs, and give
              creators professional tools without professional friction.
            </p>

            <div
              style={{
                display: "flex",
                justifyContent: "center",
                gap: "48px",
                flexWrap: "wrap",
              }}
            >
              {[
                { icon: "📈", label: "Scales with you" },
                { icon: "💡", label: "Cost transparent" },
                { icon: "🛠️", label: "Pro tools, simple UX" },
              ].map((item) => (
                <div key={item.label} style={{ textAlign: "center" }}>
                  <div style={{ fontSize: "32px", marginBottom: "8px" }}>{item.icon}</div>
                  <div style={{ fontSize: "14px", color: "rgba(255, 255, 255, 0.6)" }}>{item.label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* CTA SECTION */}
      <section style={{ padding: "120px 40px 160px", position: "relative", zIndex: 10 }}>
        <div
          style={{
            maxWidth: "800px",
            margin: "0 auto",
            textAlign: "center",
            padding: "80px 60px",
            background: "linear-gradient(135deg, rgba(220, 38, 38, 0.15), rgba(15, 15, 15, 0.9))",
            border: "2px solid rgba(220, 38, 38, 0.3)",
            borderRadius: "32px",
            backdropFilter: "blur(20px)",
            position: "relative",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              position: "absolute",
              top: "-100px",
              left: "50%",
              transform: "translateX(-50%)",
              width: "400px",
              height: "200px",
              background: "radial-gradient(ellipse, rgba(220, 38, 38, 0.3) 0%, transparent 70%)",
              filter: "blur(40px)",
              pointerEvents: "none",
            }}
          />

          <h2
            style={{
              fontSize: "clamp(32px, 5vw, 48px)",
              fontWeight: 800,
              marginBottom: "16px",
              position: "relative",
            }}
          >
            Ready to Go Further?
          </h2>

          <p
            style={{
              fontSize: "18px",
              color: "rgba(255, 255, 255, 0.7)",
              marginBottom: "40px",
              lineHeight: "1.7",
              position: "relative",
            }}
          >
            Whether you're testing a stream, running a live show, or planning something bigger,
            StreamLine gives you a solid foundation today—and powerful upgrades tomorrow.
          </p>

          <div
            style={{
              display: "flex",
              gap: "16px",
              justifyContent: "center",
              flexWrap: "wrap",
              position: "relative",
            }}
          >
            <button
              onClick={() => nav("/login")}
              style={{
                padding: "18px 40px",
                background: "linear-gradient(135deg, #dc2626, #ef4444)",
                border: "none",
                borderRadius: "12px",
                color: "#ffffff",
                fontSize: "16px",
                fontWeight: 700,
                cursor: "pointer",
                boxShadow: "0 8px 40px rgba(220, 38, 38, 0.4)",
                transition: "all 0.3s ease",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = "translateY(-4px)";
                e.currentTarget.style.boxShadow = "0 16px 60px rgba(220, 38, 38, 0.5)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = "translateY(0)";
                e.currentTarget.style.boxShadow = "0 8px 40px rgba(220, 38, 38, 0.4)";
              }}
            >
              Start Streaming Now
            </button>

            <button
              onClick={() => nav("/signup")}
              style={{
                padding: "18px 40px",
                background: "rgba(255, 255, 255, 0.05)",
                border: "2px solid rgba(255, 255, 255, 0.2)",
                borderRadius: "12px",
                color: "#ffffff",
                fontSize: "16px",
                fontWeight: 600,
                cursor: "pointer",
                transition: "all 0.3s ease",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "rgba(255, 255, 255, 0.1)";
                e.currentTarget.style.borderColor = "rgba(255, 255, 255, 0.3)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "rgba(255, 255, 255, 0.05)";
                e.currentTarget.style.borderColor = "rgba(255, 255, 255, 0.2)";
              }}
            >
              Create Account
            </button>
          </div>

          <p
            style={{
              marginTop: "32px",
              fontSize: "24px",
              fontWeight: 700,
              background: "linear-gradient(135deg, #ef4444, #f87171)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              position: "relative",
            }}
          >
            Create. Stream. Grow—without the mess.
          </p>
        </div>
      </section>

      {/* FOOTER */}
      <footer
        style={{
          padding: "40px",
          borderTop: "1px solid rgba(255, 255, 255, 0.05)",
          textAlign: "center",
          position: "relative",
          zIndex: 10,
        }}
      >
        <p style={{ fontSize: "14px", color: "rgba(255, 255, 255, 0.4)" }}>
          © {new Date().getFullYear()} StreamLine. All rights reserved.
        </p>
      </footer>

      {/* GLOBAL ANIMATIONS */}
      <style>{`
        @keyframes float {
          0%, 100% { transform: translateY(0) rotate(0deg); }
          50% { transform: translateY(-30px) rotate(5deg); }
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.7; }
        }
        @keyframes pulseDot {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.65; transform: scale(1.25); }
        }
        @keyframes bounce {
          0%, 100% { transform: translateX(-50%) translateY(0); }
          50% { transform: translateX(-50%) translateY(10px); }
        }
        @keyframes slideUp {
          from { opacity: 0; transform: translateY(30px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes slideDown {
          from { opacity: 0; transform: translateY(-20px); }
          to { opacity: 1; transform: translateY(0); }
        }

        /* Smooth scrollbar */
        ::-webkit-scrollbar { width: 8px; }
        ::-webkit-scrollbar-track { background: #000; }
        ::-webkit-scrollbar-thumb {
          background: rgba(220, 38, 38, 0.5);
          border-radius: 4px;
        }
        ::-webkit-scrollbar-thumb:hover {
          background: rgba(220, 38, 38, 0.7);
        }
      `}</style>
    </div>
  );
}

function FeatureCard({ feature }: { feature: Feature }) {
  const [isHovered, setIsHovered] = useState(false);

  return (
    <div
      style={{
        padding: "32px",
        background: isHovered
          ? "linear-gradient(135deg, rgba(220, 38, 38, 0.1), rgba(20, 20, 20, 0.95))"
          : "rgba(15, 15, 15, 0.7)",
        border: isHovered ? "1px solid rgba(220, 38, 38, 0.4)" : "1px solid rgba(255, 255, 255, 0.08)",
        borderRadius: "20px",
        backdropFilter: "blur(10px)",
        transition: "all 0.4s ease",
        transform: isHovered ? "translateY(-8px)" : "translateY(0)",
        boxShadow: isHovered ? "0 24px 60px rgba(220, 38, 38, 0.15)" : "none",
        cursor: "default",
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div
        style={{
          width: "64px",
          height: "64px",
          borderRadius: "16px",
          background: "linear-gradient(135deg, rgba(220, 38, 38, 0.2), rgba(220, 38, 38, 0.05))",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: "32px",
          marginBottom: "24px",
          transition: "transform 0.3s ease",
          transform: isHovered ? "scale(1.1)" : "scale(1)",
        }}
      >
        {feature.icon}
      </div>

      <h3
        style={{
          fontSize: "22px",
          fontWeight: 700,
          marginBottom: "16px",
          color: isHovered ? "#f87171" : "#ffffff",
          transition: "color 0.3s ease",
        }}
      >
        {feature.title}
      </h3>

      <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {feature.items.map((item) => (
          <li
            key={item}
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: "12px",
              marginBottom: "12px",
              fontSize: "15px",
              color: "rgba(255, 255, 255, 0.7)",
              lineHeight: "1.5",
            }}
          >
            <span style={{ color: "#ef4444", fontSize: "8px", marginTop: "8px" }}>●</span>
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}
