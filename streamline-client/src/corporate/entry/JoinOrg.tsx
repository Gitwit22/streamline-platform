import { FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import "../corporate.css";
import { joinOrg, createOrg, lookupOrg } from "../api/orgs";

/**
 * JoinOrg — shown after sign-in when the user has no org yet.
 *
 * Two sections:
 *   1. "Join an Organization" — enter slug + joinCode
 *   2. "Create an Organization" — for admins bootstrapping a new company
 */
export default function JoinOrg() {
  const nav = useNavigate();

  /* ── Join form state ───────────────────────────────────────── */
  const [joinSlug, setJoinSlug] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [joinLoading, setJoinLoading] = useState(false);
  const [joinError, setJoinError] = useState("");
  const [joinOrgName, setJoinOrgName] = useState("");

  /* ── Create form state ─────────────────────────────────────── */
  const [showCreate, setShowCreate] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createSlug, setCreateSlug] = useState("");
  const [createLoading, setCreateLoading] = useState(false);
  const [createError, setCreateError] = useState("");
  const [slugAvailable, setSlugAvailable] = useState<boolean | null>(null);

  /* ── Join submit ───────────────────────────────────────────── */
  const handleJoinSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setJoinError("");
    setJoinLoading(true);
    try {
      const result = await joinOrg(joinSlug.trim(), joinCode.trim());
      // success → go to dashboard
      nav("/streamline/corporate/dashboard", { replace: true });
    } catch (err: any) {
      setJoinError(err?.message || "Failed to join organization.");
    } finally {
      setJoinLoading(false);
    }
  };

  /* ── Slug lookup (live feedback) ───────────────────────────── */
  const handleJoinSlugBlur = async () => {
    const s = joinSlug.trim();
    if (s.length < 2) {
      setJoinOrgName("");
      return;
    }
    try {
      const info = await lookupOrg(s);
      setJoinOrgName(info.exists ? (info.name || s) : "");
      if (!info.exists) setJoinError("No organization found with that slug.");
    } catch {
      setJoinOrgName("");
    }
  };

  /* ── Create submit ─────────────────────────────────────────── */
  const handleCreateSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setCreateError("");

    const name = createName.trim();
    const slug = createSlug
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "");

    if (!name || name.length < 2) {
      setCreateError("Organization name must be at least 2 characters.");
      return;
    }
    if (!slug || slug.length < 2) {
      setCreateError("Slug must be at least 2 alphanumeric characters.");
      return;
    }

    setCreateLoading(true);
    try {
      const result = await createOrg(name, slug);
      // Show the join code briefly, then go to dashboard
      alert(
        `Organization created!\n\nName: ${result.name}\nSlug: ${result.slug}\nJoin Code: ${result.joinCode}\n\nShare the slug and join code with your team so they can join.`
      );
      nav("/streamline/corporate/dashboard", { replace: true });
    } catch (err: any) {
      setCreateError(err?.message || "Failed to create organization.");
    } finally {
      setCreateLoading(false);
    }
  };

  /* ── Slug availability check ───────────────────────────────── */
  const handleCreateSlugBlur = async () => {
    const slug = createSlug
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "");
    if (slug.length < 2) {
      setSlugAvailable(null);
      return;
    }
    try {
      const info = await lookupOrg(slug);
      setSlugAvailable(!info.exists);
    } catch {
      setSlugAvailable(null);
    }
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--bg)",
        padding: 24,
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 480,
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: 16,
          padding: "40px 36px",
        }}
      >
        {/* ── Header ── */}
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <h1
            style={{
              fontSize: 24,
              fontWeight: 700,
              color: "var(--text)",
              marginBottom: 8,
            }}
          >
            Welcome to StreamLine
          </h1>
          <p style={{ fontSize: 14, color: "var(--text2)" }}>
            Join your organization to get started, or create a new one.
          </p>
        </div>

        {/* ══════════════════════════════════════════════════════ */}
        {/* ── JOIN SECTION ── */}
        {/* ══════════════════════════════════════════════════════ */}
        <form onSubmit={handleJoinSubmit}>
          <h2
            style={{
              fontSize: 16,
              fontWeight: 600,
              color: "var(--blue)",
              marginBottom: 16,
            }}
          >
            Join an Organization
          </h2>

          {joinError && (
            <div
              style={{
                color: "#f87171",
                fontSize: 13,
                marginBottom: 12,
                background: "rgba(248,113,113,0.08)",
                padding: "8px 12px",
                borderRadius: 8,
              }}
            >
              {joinError}
            </div>
          )}

          <div className="form-group">
            <label className="form-label" htmlFor="join-slug">
              Organization Slug
            </label>
            <div className="input-wrap">
              <input
                type="text"
                id="join-slug"
                className="form-input"
                placeholder='e.g. "acme" or "nxtlvl"'
                value={joinSlug}
                onChange={(e) => {
                  setJoinSlug(e.target.value);
                  setJoinError("");
                }}
                onBlur={handleJoinSlugBlur}
              />
            </div>
            {joinOrgName && (
              <p style={{ fontSize: 12, color: "var(--green)", marginTop: 4 }}>
                Found: {joinOrgName}
              </p>
            )}
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="join-code">
              Join Code
            </label>
            <div className="input-wrap">
              <input
                type="text"
                id="join-code"
                className="form-input"
                placeholder='e.g. "NXTLVL-4829"'
                value={joinCode}
                onChange={(e) => {
                  setJoinCode(e.target.value.toUpperCase());
                  setJoinError("");
                }}
              />
            </div>
          </div>

          <button type="submit" className="submit-btn" disabled={joinLoading}>
            {joinLoading ? "Joining…" : "Join Organization"}
          </button>
        </form>

        {/* ══════════════════════════════════════════════════════ */}
        {/* ── CREATE SECTION ── */}
        {/* ══════════════════════════════════════════════════════ */}
        <div
          className="or-divider"
          style={{ cursor: "pointer", marginTop: 28 }}
          onClick={() => setShowCreate(!showCreate)}
        >
          <span
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: 12,
              color: "rgba(255,255,255,0.45)",
            }}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              style={{
                width: 14,
                height: 14,
                transition: "transform 0.2s",
                transform: showCreate ? "rotate(90deg)" : "rotate(0deg)",
              }}
            >
              <polyline points="9 18 15 12 9 6" />
            </svg>
            Create a new organization instead
          </span>
        </div>

        {showCreate && (
          <form onSubmit={handleCreateSubmit} style={{ marginTop: 16 }}>
            <h2
              style={{
                fontSize: 16,
                fontWeight: 600,
                color: "var(--green)",
                marginBottom: 16,
              }}
            >
              Create Organization
            </h2>

            {createError && (
              <div
                style={{
                  color: "#f87171",
                  fontSize: 13,
                  marginBottom: 12,
                  background: "rgba(248,113,113,0.08)",
                  padding: "8px 12px",
                  borderRadius: 8,
                }}
              >
                {createError}
              </div>
            )}

            <div className="form-group">
              <label className="form-label" htmlFor="create-name">
                Organization Name
              </label>
              <div className="input-wrap">
                <input
                  type="text"
                  id="create-name"
                  className="form-input"
                  placeholder='e.g. "Nxt Lvl Technology Solutions"'
                  value={createName}
                  onChange={(e) => setCreateName(e.target.value)}
                />
              </div>
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="create-slug">
                Slug{" "}
                <span
                  style={{ fontSize: 11, color: "var(--text3)", fontWeight: 400 }}
                >
                  (URL-friendly identifier)
                </span>
              </label>
              <div className="input-wrap">
                <input
                  type="text"
                  id="create-slug"
                  className="form-input"
                  placeholder='e.g. "nxtlvl"'
                  value={createSlug}
                  onChange={(e) => {
                    setCreateSlug(e.target.value);
                    setSlugAvailable(null);
                  }}
                  onBlur={handleCreateSlugBlur}
                />
              </div>
              {slugAvailable === true && (
                <p style={{ fontSize: 12, color: "var(--green)", marginTop: 4 }}>
                  Slug is available!
                </p>
              )}
              {slugAvailable === false && (
                <p style={{ fontSize: 12, color: "var(--red)", marginTop: 4 }}>
                  Slug is already taken.
                </p>
              )}
            </div>

            <button type="submit" className="submit-btn" disabled={createLoading}>
              {createLoading ? "Creating…" : "Create Organization"}
            </button>
          </form>
        )}

        {/* ── Back to login link ── */}
        <p
          style={{
            textAlign: "center",
            fontSize: 12,
            color: "var(--text3)",
            marginTop: 24,
          }}
        >
          Wrong account?{" "}
          <a
            href="/streamline/corporate/login"
            style={{ color: "var(--blue)", textDecoration: "underline" }}
            onClick={(e) => {
              e.preventDefault();
              nav("/streamline/corporate/login", { replace: true });
            }}
          >
            Sign out and log in again
          </a>
        </p>
      </div>
    </div>
  );
}
