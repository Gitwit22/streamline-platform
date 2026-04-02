import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

type HelpGuideLocationState = {
  returnTo?: string;
  originLabel?: string;
};

type HelpBlock =
  | {
      type: "heading";
      content: string;
    }
  | {
      type: "paragraph";
      content: string;
    }
  | {
      type: "list";
      items: string[];
    }
  | {
      type: "image";
      title: string;
      description: string;
    }
  | {
      type: "video";
      title: string;
      description: string;
    }
  | {
      type: "note";
      title: string;
      content: string;
    };

type HelpSection = {
  id: string;
  title: string;
  eyebrow: string;
  summary: string;
  blocks: HelpBlock[];
};

const MOBILE_BREAKPOINT = 960;

const helpSections: HelpSection[] = [
  {
    id: "getting-started",
    title: "Getting Started",
    eyebrow: "Start here",
    summary: "Everything needed to create your first room, invite guests, and launch your first session.",
    blocks: [
      { type: "heading", content: "Creating Your First Room" },
      { type: "paragraph", content: "A Room is where your live session happens." },
      {
        type: "list",
        items: [
          "Click Create Room.",
          "Enter a Room Name.",
          "Choose your settings if they are available on your plan.",
          "Click Create.",
        ],
      },
      { type: "paragraph", content: "Your room will open and be ready for guests to join." },
      { type: "heading", content: "Inviting Guests" },
      { type: "paragraph", content: "Guests join your room using an invite link." },
      {
        type: "list",
        items: [
          "Open your Room.",
          "Click Invite.",
          "Copy the Invite Link.",
          "Send the link to your guest.",
        ],
      },
      {
        type: "note",
        title: "Supported devices",
        content: "Guests can join from a desktop, laptop, or a supported mobile browser.",
      },
      { type: "heading", content: "Starting Your First Session" },
      { type: "paragraph", content: "Once you're inside your room, get your production ready before you go live." },
      {
        type: "list",
        items: [
          "Turn on your Camera.",
          "Turn on your Microphone.",
          "Wait for guests to join.",
          "Click Go Live when ready.",
        ],
      },
      { type: "paragraph", content: "Your broadcast will begin as soon as the live action is confirmed." },
      {
        type: "image",
        title: "Future room setup screenshot",
        description: "Add a screenshot of the Join page or room creation flow here later.",
      },
    ],
  },
  {
    id: "broadcasting",
    title: "Broadcasting",
    eyebrow: "Go live",
    summary: "How StreamLine moves from room setup to live output, including layout and screen sharing.",
    blocks: [
      { type: "heading", content: "Going Live" },
      { type: "paragraph", content: "Going Live starts your broadcast output." },
      {
        type: "list",
        items: [
          "Camera working.",
          "Microphone working.",
          "Guests connected.",
          "Layout selected.",
        ],
      },
      {
        type: "list",
        items: [
          "Click Go Live.",
          "Confirm broadcast start.",
          "Your program output becomes live.",
        ],
      },
      { type: "heading", content: "Layout Controls" },
      { type: "paragraph", content: "Layouts control how participants appear on screen." },
      {
        type: "list",
        items: [
          "Grid Layout — All participants shown equally.",
          "Speaker Layout — Focus on active speaker.",
          "Single View — Highlight one participant.",
        ],
      },
      {
        type: "paragraph",
        content: "To change layout, click Layout, select your desired layout, and the output updates instantly.",
      },
      { type: "heading", content: "Screen Sharing" },
      {
        type: "paragraph",
        content: "You can share your screen during a session by choosing an entire screen, a window, or a browser tab and confirming the selection.",
      },
      { type: "heading", content: "Program Window" },
      {
        type: "list",
        items: [
          "Monitor output.",
          "Confirm layout changes.",
          "Verify guest visibility.",
          "Check screen share output.",
        ],
      },
      {
        type: "note",
        title: "Best practice",
        content: "Always watch the Program Window before going live so you know the audience is seeing the correct output.",
      },
      {
        type: "video",
        title: "Future live setup walkthrough",
        description: "Embed a short walkthrough of the Go Live flow here later.",
      },
    ],
  },
  {
    id: "guests-invites",
    title: "Guests & Invites",
    eyebrow: "Bring people in",
    summary: "Invite flow, guest permissions, and the fastest checks when someone cannot join.",
    blocks: [
      { type: "heading", content: "How Guests Join" },
      { type: "paragraph", content: "Guests join using an invite link." },
      {
        type: "list",
        items: [
          "Open the invite link.",
          "Enter their Name.",
          "Enable Camera and Microphone.",
          "Click Join.",
        ],
      },
      {
        type: "paragraph",
        content: "If the room has not started yet, guests will see a waiting screen until the host or producer begins the session.",
      },
      { type: "heading", content: "Guest Permissions" },
      {
        type: "list",
        items: [
          "Guests can join the room.",
          "Guests can use microphone and camera.",
          "Guests can share screen if allowed.",
          "Guests cannot control layouts, start broadcasts, or remove users.",
        ],
      },
      {
        type: "paragraph",
        content: "Only Hosts or Producers can control production features.",
      },
      { type: "heading", content: "Troubleshooting Guest Issues" },
      {
        type: "paragraph",
        content: "If a guest cannot join, verify the invite link, room status, browser permissions, and browser support first.",
      },
      {
        type: "list",
        items: [
          "Check that the invite link is correct.",
          "Check that the room is still active.",
          "Check that camera and microphone permissions are enabled.",
          "Ask the guest to refresh, rejoin, or restart their browser.",
        ],
      },
      {
        type: "image",
        title: "Future invite flow visual",
        description: "Reserve this slot for an invite link screenshot or permissions diagram.",
      },
    ],
  },
  {
    id: "production-features",
    title: "Production Features",
    eyebrow: "Operate like a team",
    summary: "Producer workflows, host assistance, and other higher-control production patterns.",
    blocks: [
      { type: "heading", content: "Using a Producer" },
      {
        type: "paragraph",
        content: "A Producer helps manage the session and can assist hosts remotely.",
      },
      {
        type: "list",
        items: [
          "Start rooms.",
          "Manage layouts.",
          "Control the broadcast.",
          "Assist hosts remotely.",
        ],
      },
      {
        type: "note",
        title: "When this helps",
        content: "Use a producer when the host is on location, when the host cannot start the room, or when a production team is assisting.",
      },
      { type: "heading", content: "Starting a Room for Another Host" },
      {
        type: "list",
        items: [
          "Producer logs in.",
          "Opens the host's room.",
          "Starts the session.",
          "Adds the host as a participant.",
          "Controls layouts and broadcast.",
        ],
      },
      {
        type: "paragraph",
        content: "This workflow supports professional production setups where the presenter is not running the technical side.",
      },
      { type: "heading", content: "Invisible Mode (If Available)" },
      {
        type: "paragraph",
        content: "Invisible mode allows producers to manage rooms without appearing on screen.",
      },
      {
        type: "list",
        items: [
          "Run technical setup.",
          "Manage layouts.",
          "Prepare guests before broadcast.",
        ],
      },
      {
        type: "video",
        title: "Future producer workflow demo",
        description: "Embed a producer-control walkthrough here once video documentation is ready.",
      },
    ],
  },
  {
    id: "plans-usage",
    title: "Plans & Usage",
    eyebrow: "Know your limits",
    summary: "Minutes, storage, plan upgrades, and recording/media behavior in one place.",
    blocks: [
      { type: "heading", content: "Understanding Streaming Minutes" },
      {
        type: "paragraph",
        content: "Streaming minutes measure how long your broadcasts run.",
      },
      {
        type: "list",
        items: [
          "Live broadcast time counts.",
          "Recording time counts.",
          "Multi-stream output time counts.",
          "Idle room time does not count.",
          "Waiting time before going live does not count.",
        ],
      },
      { type: "heading", content: "Recording Storage" },
      {
        type: "paragraph",
        content: "Recordings use storage space, and storage grows as you save recordings, upload media, and keep session assets.",
      },
      {
        type: "note",
        title: "Storage habit",
        content: "Manage storage regularly to avoid hitting your plan limits unexpectedly.",
      },
      { type: "heading", content: "Upgrading Plans" },
      {
        type: "paragraph",
        content: "If you need more streaming minutes, storage, or production features, upgrade from Settings → Billing.",
      },
      { type: "heading", content: "Recording & Media (If Enabled)" },
      {
        type: "list",
        items: [
          "Open Recordings after a session.",
          "Select a session to play or download the file.",
          "Use Download to save a recording to your computer.",
        ],
      },
      {
        type: "image",
        title: "Future billing and usage screenshot",
        description: "Use this slot for a plan limits or recordings library screenshot later.",
      },
    ],
  },
  {
    id: "troubleshooting",
    title: "Troubleshooting",
    eyebrow: "Fix the common failures",
    summary: "Fast diagnosis steps for black screens, device issues, guest problems, FAQs, and support handoff.",
    blocks: [
      { type: "heading", content: "Black Screen Issues" },
      {
        type: "list",
        items: [
          "Check that the camera is enabled.",
          "Check that a layout is selected.",
          "Check that screen share is working if you expect it in output.",
          "Check browser permissions.",
          "Refresh the page, rejoin the session, or restart the browser if needed.",
        ],
      },
      { type: "heading", content: "Audio Problems" },
      {
        type: "list",
        items: [
          "Check that the microphone is enabled.",
          "Check that the correct microphone is selected.",
          "Check browser permissions.",
          "Re-select the microphone, refresh the page, or restart the browser.",
        ],
      },
      { type: "heading", content: "Camera Problems" },
      {
        type: "list",
        items: [
          "Check that camera permission is enabled.",
          "Check that the correct camera is selected.",
          "Restart the camera device, refresh the browser, or rejoin the session.",
        ],
      },
      { type: "heading", content: "Guest Cannot Join" },
      {
        type: "list",
        items: [
          "Check that the invite link is still valid.",
          "Check that the room is still active.",
          "Check that the browser is supported.",
          "Send a new invite or ask the guest to refresh the page.",
        ],
      },
      { type: "heading", content: "Frequently Asked Questions" },
      {
        type: "list",
        items: [
          "Do guests need an account? No. Guests can join using an invite link.",
          "Can I change layouts during a live session? Yes. Layout changes update instantly.",
          "Can I record sessions? Yes, if recording is enabled on your plan.",
          "Can I invite multiple guests? Yes. Send the invite link to multiple participants.",
          "Can I broadcast to social platforms? Yes, if streaming integrations are enabled.",
        ],
      },
      { type: "heading", content: "Need More Help?" },
      {
        type: "paragraph",
        content: "If you need support, open the Help Menu, choose Support, and submit a request with a clear description, a screenshot if possible, and the steps taken before the issue appeared.",
      },
      {
        type: "video",
        title: "Future troubleshooting walkthrough",
        description: "Reserve this slot for a quick diagnostic video covering the most common recovery steps.",
      },
    ],
  },
];

function getIsMobileViewport() {
  if (typeof window === "undefined") return false;
  return window.innerWidth < MOBILE_BREAKPOINT;
}

function getSectionFromHash(hash: string) {
  const id = hash.replace("#", "").trim();
  if (!id) return helpSections[0].id;
  return helpSections.some((section) => section.id === id) ? id : helpSections[0].id;
}

function renderBlock(block: HelpBlock, index: number) {
  if (block.type === "heading") {
    return (
      <h2
        key={index}
        style={{
          margin: index === 0 ? 0 : "28px 0 0",
          fontSize: "24px",
          fontWeight: 700,
          letterSpacing: "-0.02em",
        }}
      >
        {block.content}
      </h2>
    );
  }

  if (block.type === "paragraph") {
    return (
      <p
        key={index}
        style={{
          margin: "14px 0 0",
          color: "#cbd5e1",
          fontSize: "15px",
          lineHeight: 1.8,
        }}
      >
        {block.content}
      </p>
    );
  }

  if (block.type === "list") {
    return (
      <ul
        key={index}
        style={{
          margin: "16px 0 0",
          paddingLeft: "20px",
          color: "#e2e8f0",
          display: "grid",
          gap: "10px",
          lineHeight: 1.7,
        }}
      >
        {block.items.map((item) => (
          <li key={item} style={{ paddingLeft: "4px" }}>
            {item}
          </li>
        ))}
      </ul>
    );
  }

  if (block.type === "note") {
    return (
      <div
        key={index}
        style={{
          marginTop: "18px",
          borderRadius: "16px",
          border: "1px solid rgba(59, 130, 246, 0.22)",
          background: "rgba(59, 130, 246, 0.08)",
          padding: "16px 18px",
        }}
      >
        <div style={{ fontSize: "12px", color: "#93c5fd", letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 700, marginBottom: "8px" }}>
          {block.title}
        </div>
        <div style={{ color: "#dbeafe", lineHeight: 1.7, fontSize: "14px" }}>{block.content}</div>
      </div>
    );
  }

  if (block.type === "image") {
    return (
      <div
        key={index}
        style={{
          marginTop: "22px",
          borderRadius: "20px",
          border: "1px dashed rgba(248, 113, 113, 0.32)",
          background: "rgba(255,255,255,0.025)",
          padding: "20px",
        }}
      >
        <div style={{ fontSize: "12px", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "#fda4af", marginBottom: "8px" }}>
          Future image support
        </div>
        <div style={{ fontSize: "16px", fontWeight: 700, marginBottom: "8px" }}>{block.title}</div>
        <div style={{ color: "#cbd5e1", lineHeight: 1.7, fontSize: "14px", marginBottom: "16px" }}>{block.description}</div>
        <div
          style={{
            borderRadius: "16px",
            minHeight: "180px",
            border: "1px dashed rgba(255,255,255,0.16)",
            background: "linear-gradient(135deg, rgba(220, 38, 38, 0.08), rgba(59, 130, 246, 0.06))",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#94a3b8",
            fontSize: "14px",
          }}
        >
          Screenshot or annotated image slot
        </div>
      </div>
    );
  }

  return (
    <div
      key={index}
      style={{
        marginTop: "22px",
        borderRadius: "20px",
        border: "1px dashed rgba(96, 165, 250, 0.32)",
        background: "rgba(255,255,255,0.025)",
        padding: "20px",
      }}
    >
      <div style={{ fontSize: "12px", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "#93c5fd", marginBottom: "8px" }}>
        Future embedded video support
      </div>
      <div style={{ fontSize: "16px", fontWeight: 700, marginBottom: "8px" }}>{block.title}</div>
      <div style={{ color: "#cbd5e1", lineHeight: 1.7, fontSize: "14px", marginBottom: "16px" }}>{block.description}</div>
      <div
        style={{
          borderRadius: "16px",
          minHeight: "220px",
          border: "1px dashed rgba(255,255,255,0.16)",
          background: "linear-gradient(135deg, rgba(15, 23, 42, 0.95), rgba(30, 41, 59, 0.82))",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#94a3b8",
          fontSize: "14px",
        }}
      >
        Embedded video slot
      </div>
    </div>
  );
}

export default function HelpGuidePage() {
  const nav = useNavigate();
  const location = useLocation();
  const state = (location.state as HelpGuideLocationState | null) ?? null;
  const returnTo = state?.returnTo ?? "/join";
  const originLabel = state?.originLabel ?? "workspace";
  const [isMobile, setIsMobile] = useState(() => getIsMobileViewport());
  const [sidebarOpen, setSidebarOpen] = useState(() => !getIsMobileViewport());
  const [activeSectionId, setActiveSectionId] = useState(() => getSectionFromHash(location.hash));
  const [contentVisible, setContentVisible] = useState(true);

  useEffect(() => {
    const handleResize = () => {
      const nextIsMobile = getIsMobileViewport();
      setIsMobile(nextIsMobile);
      setSidebarOpen(!nextIsMobile);
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    setActiveSectionId(getSectionFromHash(location.hash));
  }, [location.hash]);

  useEffect(() => {
    setContentVisible(false);
    const timeoutId = window.setTimeout(() => setContentVisible(true), 24);
    if (typeof window !== "undefined") {
      const nextUrl = `${location.pathname}#${activeSectionId}`;
      window.history.replaceState(window.history.state, "", nextUrl);
    }
    return () => window.clearTimeout(timeoutId);
  }, [activeSectionId, location.pathname]);

  const activeSection = helpSections.find((section) => section.id === activeSectionId) ?? helpSections[0];
  const activeIndex = helpSections.findIndex((section) => section.id === activeSection.id);
  const previousSection = activeIndex > 0 ? helpSections[activeIndex - 1] : null;
  const nextSection = activeIndex < helpSections.length - 1 ? helpSections[activeIndex + 1] : null;

  const selectSection = (sectionId: string) => {
    setActiveSectionId(sectionId);
    if (isMobile) {
      setSidebarOpen(false);
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "linear-gradient(180deg, #050816 0%, #0f172a 55%, #050816 100%)",
        color: "#f8fafc",
        position: "relative",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          background: "radial-gradient(circle at top right, rgba(220, 38, 38, 0.16), transparent 32%), radial-gradient(circle at bottom left, rgba(59, 130, 246, 0.12), transparent 28%)",
        }}
      />

      <div
        style={{
          position: "relative",
          zIndex: 1,
          maxWidth: "1280px",
          margin: "0 auto",
          padding: "32px 20px 64px",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "16px", flexWrap: "wrap", marginBottom: "24px" }}>
          <button
            type="button"
            onClick={() => nav(returnTo)}
            style={{
              padding: "10px 14px",
              borderRadius: "999px",
              border: "1px solid rgba(255,255,255,0.14)",
              background: "rgba(255,255,255,0.05)",
              color: "#f8fafc",
              cursor: "pointer",
              fontWeight: 600,
            }}
          >
            ← Back to {originLabel}
          </button>

          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "8px",
              padding: "8px 14px",
              borderRadius: "999px",
              border: "1px solid rgba(248, 113, 113, 0.24)",
              background: "rgba(220, 38, 38, 0.1)",
              color: "#fca5a5",
              fontSize: "12px",
              fontWeight: 700,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
            }}
          >
            StreamLine Help Guide
          </div>
        </div>

        <section
          style={{
            borderRadius: "28px",
            border: "1px solid rgba(255,255,255,0.1)",
            background: "linear-gradient(180deg, rgba(15, 23, 42, 0.9) 0%, rgba(2, 6, 23, 0.92) 100%)",
            boxShadow: "0 32px 90px rgba(0,0,0,0.45)",
            padding: isMobile ? "24px" : "32px",
            marginBottom: "24px",
          }}
        >
          <div style={{ display: "flex", gap: "18px", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap" }}>
            <div style={{ maxWidth: "760px" }}>
              <div style={{ fontSize: "12px", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "#f87171", marginBottom: "12px" }}>
                Dedicated help center
              </div>
              <h1 style={{ margin: 0, fontSize: "clamp(2.4rem, 6vw, 4.6rem)", lineHeight: 0.95, fontWeight: 800 }}>
                StreamLine Help Guide
              </h1>
              <p style={{ margin: "18px 0 0", color: "#94a3b8", fontSize: "1.05rem", lineHeight: 1.7 }}>
                Browse the guide by section from the left navigation. Content is stored as structured section data so this page can expand cleanly with screenshots, videos, and more workflow detail over time.
              </p>
            </div>

            <div style={{ display: "grid", gap: "10px", minWidth: isMobile ? "100%" : "260px" }}>
              <div style={{ borderRadius: "16px", border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.04)", padding: "14px 16px" }}>
                <div style={{ fontSize: "12px", color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700, marginBottom: "6px" }}>Sections</div>
                <div style={{ fontSize: "28px", fontWeight: 800 }}>{helpSections.length}</div>
              </div>
              <div style={{ borderRadius: "16px", border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.04)", padding: "14px 16px" }}>
                <div style={{ fontSize: "12px", color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700, marginBottom: "6px" }}>Current section</div>
                <div style={{ fontSize: "16px", fontWeight: 700 }}>{activeSection.title}</div>
              </div>
            </div>
          </div>
        </section>

        {isMobile && (
          <div style={{ marginBottom: "16px" }}>
            <button
              type="button"
              onClick={() => setSidebarOpen((open) => !open)}
              style={{
                width: "100%",
                padding: "14px 16px",
                borderRadius: "16px",
                border: "1px solid rgba(255,255,255,0.1)",
                background: "rgba(15, 23, 42, 0.88)",
                color: "#f8fafc",
                fontWeight: 700,
                fontSize: "14px",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                cursor: "pointer",
                boxShadow: "0 20px 40px rgba(0,0,0,0.28)",
              }}
            >
              <span>Browse Help Sections</span>
              <span>{sidebarOpen ? "Hide" : "Show"}</span>
            </button>
          </div>
        )}

        <div
          style={{
            display: "grid",
            gridTemplateColumns: isMobile ? "1fr" : "300px minmax(0, 1fr)",
            gap: "24px",
            alignItems: "start",
          }}
        >
          {!isMobile || sidebarOpen ? (
            <aside
              style={{
                position: isMobile ? "relative" : "sticky",
                top: isMobile ? undefined : "24px",
                borderRadius: "24px",
                border: "1px solid rgba(255,255,255,0.1)",
                background: "rgba(15, 23, 42, 0.88)",
                backdropFilter: "blur(18px)",
                boxShadow: "0 24px 64px rgba(0,0,0,0.32)",
                padding: "18px",
                transition: "transform 220ms ease, opacity 220ms ease",
              }}
            >
              <div style={{ padding: "8px 8px 14px" }}>
                <div style={{ fontSize: "12px", color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700, marginBottom: "6px" }}>
                  Sidebar navigation
                </div>
                <div style={{ fontSize: "18px", fontWeight: 800 }}>Help topics</div>
              </div>

              <div style={{ display: "grid", gap: "10px" }}>
                {helpSections.map((section) => {
                  const isActive = section.id === activeSection.id;
                  return (
                    <button
                      key={section.id}
                      type="button"
                      onClick={() => selectSection(section.id)}
                      style={{
                        width: "100%",
                        textAlign: "left",
                        borderRadius: "18px",
                        border: isActive
                          ? "1px solid rgba(248, 113, 113, 0.28)"
                          : "1px solid rgba(255,255,255,0.06)",
                        background: isActive
                          ? "linear-gradient(135deg, rgba(220, 38, 38, 0.16), rgba(30, 41, 59, 0.95))"
                          : "rgba(255,255,255,0.03)",
                        padding: "14px",
                        cursor: "pointer",
                        color: "#f8fafc",
                        boxShadow: isActive ? "0 12px 28px rgba(220, 38, 38, 0.12)" : "none",
                        transition: "all 180ms ease",
                      }}
                    >
                      <div style={{ fontSize: "14px", fontWeight: 700, marginBottom: "4px" }}>{section.title}</div>
                      <div style={{ fontSize: "12px", color: isActive ? "#fecaca" : "#94a3b8", lineHeight: 1.5 }}>
                        {section.summary}
                      </div>
                    </button>
                  );
                })}
              </div>
            </aside>
          ) : null}

          <article
            style={{
              borderRadius: "24px",
              border: "1px solid rgba(255,255,255,0.1)",
              background: "linear-gradient(180deg, rgba(15, 23, 42, 0.88) 0%, rgba(2, 6, 23, 0.94) 100%)",
              boxShadow: "0 24px 64px rgba(0,0,0,0.32)",
              overflow: "hidden",
            }}
          >
            <div
              key={activeSection.id}
              style={{
                padding: isMobile ? "22px" : "32px",
                opacity: contentVisible ? 1 : 0,
                transform: contentVisible ? "translateY(0)" : "translateY(8px)",
                transition: "opacity 220ms ease, transform 220ms ease",
              }}
            >
              <div style={{ marginBottom: "24px" }}>
                <div style={{ fontSize: "12px", color: "#f87171", textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 700, marginBottom: "10px" }}>
                  {activeSection.eyebrow}
                </div>
                <h1 style={{ margin: 0, fontSize: "clamp(2rem, 4vw, 3rem)", lineHeight: 1.05, fontWeight: 800 }}>
                  {activeSection.title}
                </h1>
                <p style={{ margin: "14px 0 0", color: "#94a3b8", fontSize: "16px", lineHeight: 1.8, maxWidth: "760px" }}>
                  {activeSection.summary}
                </p>
              </div>

              <div style={{ display: "grid", gap: "2px" }}>
                {activeSection.blocks.map((block, index) => renderBlock(block, index))}
              </div>

              <div
                style={{
                  marginTop: "32px",
                  paddingTop: "24px",
                  borderTop: "1px solid rgba(255,255,255,0.08)",
                  display: "flex",
                  gap: "12px",
                  justifyContent: "space-between",
                  flexWrap: "wrap",
                }}
              >
                <button
                  type="button"
                  disabled={!previousSection}
                  onClick={() => previousSection && selectSection(previousSection.id)}
                  style={{
                    padding: "12px 16px",
                    borderRadius: "14px",
                    border: "1px solid rgba(255,255,255,0.12)",
                    background: previousSection ? "rgba(255,255,255,0.04)" : "rgba(255,255,255,0.02)",
                    color: previousSection ? "#f8fafc" : "#64748b",
                    cursor: previousSection ? "pointer" : "not-allowed",
                    fontWeight: 700,
                  }}
                >
                  ← {previousSection ? previousSection.title : "Start"}
                </button>

                <button
                  type="button"
                  disabled={!nextSection}
                  onClick={() => nextSection && selectSection(nextSection.id)}
                  style={{
                    padding: "12px 16px",
                    borderRadius: "14px",
                    border: "none",
                    background: nextSection
                      ? "linear-gradient(135deg, #dc2626, #ef4444)"
                      : "rgba(255,255,255,0.05)",
                    color: nextSection ? "#ffffff" : "#94a3b8",
                    cursor: nextSection ? "pointer" : "not-allowed",
                    fontWeight: 700,
                    boxShadow: nextSection ? "0 12px 28px rgba(220, 38, 38, 0.22)" : "none",
                  }}
                >
                  {nextSection ? `${nextSection.title} →` : "End of guide"}
                </button>
              </div>
            </div>
          </article>
        </div>
      </div>
    </div>
  );
}