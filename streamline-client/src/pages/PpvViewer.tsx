/**
 * PPV Viewer Page — /ppv/:eventId
 *
 * Public page (no auth required) that shows:
 * - Donation mode: player immediately + donation section
 * - Fixed/PWYW: paywall until access code is redeemed
 * - Success redirect: shows access code after payment
 */
import React, { useEffect, useState, useCallback } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { apiFetch } from "../lib/api";
import { API_BASE } from "../lib/apiBase";

type MonetizationMode = "off" | "fixed" | "pwyw" | "donation";

interface EventInfo {
  id: string;
  roomId: string;
  name: string;
  startsAt: string | null;
  monetizationMode: MonetizationMode;
  currency: string;
  fixedAmountCents: number | null;
  pwywMinCents: number | null;
  donationPresetsCents: number[];
  allowCustomDonation: boolean;
  status: string;
}

function formatCents(cents: number, currency = "usd"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(cents / 100);
}

export default function PpvViewer() {
  const { eventId } = useParams<{ eventId: string }>();
  const [searchParams] = useSearchParams();

  const isSuccess = searchParams.get("success") === "1";
  const sessionId = searchParams.get("session_id") || "";
  const isCanceled = searchParams.get("canceled") === "1";

  const [event, setEvent] = useState<EventInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Access state
  const [hasAccess, setHasAccess] = useState(false);
  const [accessChecked, setAccessChecked] = useState(false);

  // Code reveal (after payment success)
  const [revealedCode, setRevealedCode] = useState<string | null>(null);
  const [codePolling, setCodePolling] = useState(false);
  const [codeCopied, setCodeCopied] = useState(false);

  // Code redeem
  const [showCodeEntry, setShowCodeEntry] = useState(false);
  const [codeInput, setCodeInput] = useState("");
  const [redeemError, setRedeemError] = useState<string | null>(null);
  const [redeeming, setRedeeming] = useState(false);

  // PWYW / donation amount
  const [customAmountDollars, setCustomAmountDollars] = useState("");

  // Checkout
  const [checkingOut, setCheckingOut] = useState(false);

  // ── Load event ────────────────────────────────────────────────────
  useEffect(() => {
    if (!eventId) return;
    (async () => {
      try {
        const res = await apiFetch(`/api/monetization/events/${eventId}`, {}, { allowNonOk: true });
        if (!res.ok) {
          setError("Event not found");
          return;
        }
        const data = await res.json();
        setEvent(data.event);
      } catch (err: any) {
        setError("Failed to load event");
      } finally {
        setLoading(false);
      }
    })();
  }, [eventId]);

  // ── Check access (gate) ──────────────────────────────────────────
  const checkAccess = useCallback(async () => {
    if (!eventId) return;
    try {
      const res = await apiFetch("/api/monetization/enter", {
        method: "POST",
        body: JSON.stringify({ eventId }),
      }, { allowNonOk: true });
      const data = await res.json();
      setHasAccess(!!data.access);
    } catch {
      setHasAccess(false);
    } finally {
      setAccessChecked(true);
    }
  }, [eventId]);

  useEffect(() => {
    if (event) checkAccess();
  }, [event, checkAccess]);

  // ── Poll for access code after successful payment ────────────────
  useEffect(() => {
    if (!isSuccess || !sessionId || revealedCode) return;
    setCodePolling(true);
    let attempts = 0;
    const maxAttempts = 30;

    const interval = setInterval(async () => {
      attempts++;
      try {
        const res = await apiFetch(
          `/api/monetization/code?session_id=${encodeURIComponent(sessionId)}`
        );
        const data = await res.json();
        if (data.ready && data.code) {
          setRevealedCode(data.code);
          setCodePolling(false);
          clearInterval(interval);
        }
      } catch {}

      if (attempts >= maxAttempts) {
        setCodePolling(false);
        clearInterval(interval);
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [isSuccess, sessionId, revealedCode]);

  // ── Checkout handler ─────────────────────────────────────────────
  async function handleCheckout(type: "access" | "donation", amountCents?: number) {
    if (!event) return;
    setCheckingOut(true);
    setError(null);
    try {
      const body: Record<string, any> = { eventId: event.id, type };
      if (amountCents) body.amountCents = amountCents;

      const res = await apiFetch("/api/monetization/checkout", {
        method: "POST",
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        throw new Error("No checkout URL");
      }
    } catch (err: any) {
      setError(err?.body?.error || err?.message || "Checkout failed");
      setCheckingOut(false);
    }
  }

  // ── Redeem code handler ──────────────────────────────────────────
  async function handleRedeem() {
    if (!eventId || !codeInput.trim()) return;
    setRedeeming(true);
    setRedeemError(null);
    try {
      const res = await apiFetch("/api/monetization/redeem", {
        method: "POST",
        body: JSON.stringify({ eventId, code: codeInput.trim() }),
      }, { allowNonOk: true });
      const data = await res.json();
      if (data.ok) {
        setHasAccess(true);
        setShowCodeEntry(false);
      } else {
        setRedeemError(data.error || "Invalid code");
      }
    } catch (err: any) {
      setRedeemError(err?.body?.error || "Redeem failed");
    } finally {
      setRedeeming(false);
    }
  }

  // ── Styles ────────────────────────────────────────────────────────
  const container: React.CSSProperties = {
    maxWidth: 600,
    margin: "0 auto",
    padding: 24,
    color: "#fff",
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    minHeight: "100vh",
    background: "#0f0f1a",
  };

  const card: React.CSSProperties = {
    background: "#1a1a2e",
    borderRadius: 12,
    padding: 24,
    marginBottom: 16,
    border: "1px solid rgba(255,255,255,0.08)",
  };

  const btnPrimary: React.CSSProperties = {
    padding: "12px 24px",
    borderRadius: 8,
    border: "none",
    background: "#6366f1",
    color: "#fff",
    fontSize: 15,
    fontWeight: 600,
    cursor: "pointer",
    width: "100%",
  };

  const btnSecondary: React.CSSProperties = {
    padding: "10px 20px",
    borderRadius: 8,
    border: "1px solid rgba(255,255,255,0.15)",
    background: "rgba(255,255,255,0.05)",
    color: "#fff",
    fontSize: 14,
    cursor: "pointer",
  };

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "10px 14px",
    borderRadius: 8,
    border: "1px solid rgba(255,255,255,0.15)",
    background: "rgba(255,255,255,0.05)",
    color: "#fff",
    fontSize: 15,
    boxSizing: "border-box",
  };

  const chipStyle: React.CSSProperties = {
    padding: "8px 16px",
    borderRadius: 20,
    border: "1px solid rgba(255,255,255,0.2)",
    background: "rgba(255,255,255,0.05)",
    color: "#fff",
    fontSize: 14,
    cursor: "pointer",
  };

  // ── Loading / Error states ────────────────────────────────────────
  if (loading) {
    return <div style={container}><p>Loading event…</p></div>;
  }
  if (error && !event) {
    return <div style={container}><p style={{ color: "#ef4444" }}>{error}</p></div>;
  }
  if (!event) {
    return <div style={container}><p>Event not found.</p></div>;
  }

  const isPaid = event.monetizationMode === "fixed" || event.monetizationMode === "pwyw";

  // ── Success page: show access code ────────────────────────────────
  if (isSuccess && sessionId && isPaid && !hasAccess) {
    return (
      <div style={container}>
        <div style={card}>
          <h1 style={{ fontSize: 20, marginBottom: 8 }}>Payment Successful! 🎉</h1>
          <p style={{ color: "#aaa", marginBottom: 16 }}>{event.name}</p>

          {codePolling && !revealedCode && (
            <p style={{ color: "#facc15" }}>Generating your access code…</p>
          )}

          {revealedCode && (
            <>
              <div style={{
                background: "rgba(99, 102, 241, 0.15)",
                border: "2px solid #6366f1",
                borderRadius: 12,
                padding: 20,
                textAlign: "center",
                marginBottom: 16,
              }}>
                <div style={{ fontSize: 11, color: "#aaa", marginBottom: 8, textTransform: "uppercase", letterSpacing: 1 }}>
                  Your Access Code
                </div>
                <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: 4, fontFamily: "monospace" }}>
                  {revealedCode}
                </div>
              </div>

              <div style={{
                background: "rgba(250, 204, 21, 0.1)",
                border: "1px solid rgba(250, 204, 21, 0.3)",
                borderRadius: 8,
                padding: 12,
                marginBottom: 16,
              }}>
                <p style={{ fontSize: 13, color: "#facc15", margin: 0, fontWeight: 600 }}>
                  ⚠️ Save this code now. This code can only be claimed once.
                </p>
              </div>

              <div style={{ display: "flex", gap: 8 }}>
                <button
                  style={btnSecondary}
                  onClick={() => {
                    navigator.clipboard.writeText(revealedCode);
                    setCodeCopied(true);
                    setTimeout(() => setCodeCopied(false), 2000);
                  }}
                >
                  {codeCopied ? "Copied!" : "Copy Code"}
                </button>
                <button
                  style={btnPrimary}
                  onClick={async () => {
                    // Pre-fill the code and clear success URL params
                    setCodeInput(revealedCode);
                    window.history.replaceState({}, "", `/ppv/${event.id}`);
                    // Redeem the code for the current device
                    setRedeeming(true);
                    try {
                      const res = await apiFetch("/api/monetization/redeem", {
                        method: "POST",
                        body: JSON.stringify({ eventId: event.id, code: revealedCode }),
                      }, { allowNonOk: true });
                      const data = await res.json();
                      if (data.ok) {
                        setHasAccess(true);
                      } else {
                        setRedeemError(data.error || "Redeem failed");
                        setShowCodeEntry(true);
                      }
                    } catch {
                      setRedeemError("Redeem failed");
                      setShowCodeEntry(true);
                    } finally {
                      setRedeeming(false);
                    }
                  }}
                  disabled={redeeming}
                >
                  {redeeming ? "Entering…" : "Enter Stream →"}
                </button>
              </div>
            </>
          )}

          {!codePolling && !revealedCode && (
            <p style={{ color: "#ef4444" }}>
              Could not retrieve your access code. Please contact support.
            </p>
          )}
        </div>
      </div>
    );
  }

  // ── Canceled ──────────────────────────────────────────────────────
  if (isCanceled) {
    return (
      <div style={container}>
        <div style={card}>
          <h2 style={{ fontSize: 18 }}>Payment Canceled</h2>
          <p style={{ color: "#aaa" }}>You can try again below.</p>
        </div>
        {/* Fall through to normal view below */}
      </div>
    );
  }

  // ── Player placeholder ────────────────────────────────────────────
  const PlayerPlaceholder = () => (
    <div style={{
      background: "#000",
      borderRadius: 12,
      aspectRatio: "16/9",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      marginBottom: 16,
      fontSize: 14,
      color: "#666",
    }}>
      {event.status === "live" ? "🔴 Live Stream Player" : "Stream not yet live"}
    </div>
  );

  // ── Donation section ──────────────────────────────────────────────
  const DonationSection = () => (
    <div style={card}>
      <h3 style={{ fontSize: 15, marginBottom: 12 }}>Support this stream</h3>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        {event.donationPresetsCents.map((cents) => (
          <button
            key={cents}
            style={chipStyle}
            onClick={() => handleCheckout("donation", cents)}
            disabled={checkingOut}
          >
            {formatCents(cents, event.currency)}
          </button>
        ))}
      </div>
      {event.allowCustomDonation && (
        <div style={{ display: "flex", gap: 8 }}>
          <input
            style={{ ...inputStyle, flex: 1 }}
            type="number"
            min="1"
            step="0.01"
            placeholder="Custom amount (min $1.00)"
            value={customAmountDollars}
            onChange={(e) => setCustomAmountDollars(e.target.value)}
          />
          <button
            style={{
              ...btnSecondary,
              opacity: customAmountDollars && parseFloat(customAmountDollars) < 1 ? 0.5 : 1,
            }}
            onClick={() => {
              const cents = Math.round(parseFloat(customAmountDollars || "0") * 100);
              if (cents < 100) {
                setError("Minimum donation is $1.00");
                return;
              }
              setError(null);
              handleCheckout("donation", cents);
            }}
            disabled={checkingOut}
          >
            Donate
          </button>
        </div>
      )}
    </div>
  );

  // ── DONATION mode: show player immediately ────────────────────────
  if (event.monetizationMode === "donation") {
    return (
      <div style={container}>
        <h1 style={{ fontSize: 20, marginBottom: 4 }}>{event.name}</h1>
        {event.startsAt && (
          <p style={{ color: "#888", fontSize: 13, marginBottom: 16 }}>
            {new Date(event.startsAt).toLocaleString()}
          </p>
        )}
        <PlayerPlaceholder />
        <DonationSection />
      </div>
    );
  }

  // ── OFF mode ──────────────────────────────────────────────────────
  if (event.monetizationMode === "off") {
    return (
      <div style={container}>
        <h1 style={{ fontSize: 20, marginBottom: 4 }}>{event.name}</h1>
        <PlayerPlaceholder />
      </div>
    );
  }

  // ── PAID modes (fixed / pwyw): check access ───────────────────────
  if (hasAccess) {
    return (
      <div style={container}>
        <h1 style={{ fontSize: 20, marginBottom: 4 }}>{event.name}</h1>
        {event.startsAt && (
          <p style={{ color: "#888", fontSize: 13, marginBottom: 16 }}>
            {new Date(event.startsAt).toLocaleString()}
          </p>
        )}
        <PlayerPlaceholder />
        <p style={{ color: "#22c55e", fontSize: 13 }}>✓ Access granted</p>
      </div>
    );
  }

  // ── Paywall ───────────────────────────────────────────────────────
  return (
    <div style={container}>
      <div style={card}>
        <h1 style={{ fontSize: 20, marginBottom: 4 }}>{event.name}</h1>
        {event.startsAt && (
          <p style={{ color: "#888", fontSize: 13, marginBottom: 16 }}>
            {new Date(event.startsAt).toLocaleString()}
          </p>
        )}

        <div style={{
          background: "rgba(99, 102, 241, 0.1)",
          borderRadius: 12,
          padding: 20,
          textAlign: "center",
          marginBottom: 16,
        }}>
          {event.monetizationMode === "fixed" && (
            <>
              <p style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>
                {formatCents(event.fixedAmountCents!, event.currency)}
              </p>
              <button
                style={btnPrimary}
                onClick={() => handleCheckout("access")}
                disabled={checkingOut}
              >
                {checkingOut ? "Redirecting…" : `Pay ${formatCents(event.fixedAmountCents!, event.currency)} to Watch`}
              </button>
            </>
          )}

          {event.monetizationMode === "pwyw" && (
            <>
              <p style={{ fontSize: 14, color: "#aaa", marginBottom: 12 }}>
                Choose your price{event.pwywMinCents ? ` (min ${formatCents(event.pwywMinCents, event.currency)})` : ""}
              </p>
              <div style={{ display: "flex", gap: 8, justifyContent: "center", marginBottom: 12, flexWrap: "wrap" }}>
                {event.donationPresetsCents.map((cents) => (
                  <button
                    key={cents}
                    style={chipStyle}
                    onClick={() => handleCheckout("access", cents)}
                    disabled={checkingOut}
                  >
                    {formatCents(cents, event.currency)}
                  </button>
                ))}
              </div>
              <div style={{ display: "flex", gap: 8, maxWidth: 300, margin: "0 auto" }}>
                <input
                  style={{ ...inputStyle, flex: 1 }}
                  type="number"
                  min={((event.pwywMinCents || 100) / 100).toString()}
                  step="0.01"
                  placeholder="Amount ($)"
                  value={customAmountDollars}
                  onChange={(e) => setCustomAmountDollars(e.target.value)}
                />
                <button
                  style={btnSecondary}
                  onClick={() => {
                    const cents = Math.round(parseFloat(customAmountDollars || "0") * 100);
                    handleCheckout("access", cents);
                  }}
                  disabled={checkingOut}
                >
                  Pay to Watch
                </button>
              </div>
            </>
          )}
        </div>

        {/* Code entry */}
        <div style={{ marginTop: 16 }}>
          <button
            style={{ ...btnSecondary, width: "100%", textAlign: "left" }}
            onClick={() => setShowCodeEntry(!showCodeEntry)}
          >
            {showCodeEntry ? "▾" : "▸"} Already paid? Enter your access code
          </button>

          {showCodeEntry && (
            <div style={{ marginTop: 12 }}>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  style={{ ...inputStyle, flex: 1, fontFamily: "monospace", letterSpacing: 2, textTransform: "uppercase" }}
                  placeholder="Enter code"
                  value={codeInput}
                  onChange={(e) => setCodeInput(e.target.value.toUpperCase())}
                  onKeyDown={(e) => { if (e.key === "Enter") handleRedeem(); }}
                />
                <button
                  style={btnPrimary}
                  onClick={handleRedeem}
                  disabled={redeeming || !codeInput.trim()}
                >
                  {redeeming ? "…" : "Redeem"}
                </button>
              </div>
              {redeemError && (
                <p style={{ color: "#ef4444", fontSize: 13, marginTop: 8 }}>{redeemError}</p>
              )}
            </div>
          )}
        </div>
      </div>

      {error && <p style={{ color: "#ef4444", fontSize: 13 }}>{error}</p>}
    </div>
  );
}
