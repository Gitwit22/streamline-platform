import { useState, useEffect, useMemo } from "react";
import { useAuthMe, isAuthUserInTestMode } from "../hooks/useAuthMe";
import { PLAN_IDS, PlanId, isPlanId } from "../lib/planIds";
import { API_BASE } from "../lib/apiBase";
import { logAuthDebugContext } from "../lib/logAuthDebug";
import { useNavigate, useSearchParams,} from "react-router-dom";
import { apiFetch, apiFetchAuth, clearAuthStorage } from "../lib/api";
import { useFeatureAccess } from "../hooks/useFeatureAccess";
import { useEffectiveEntitlements } from "../hooks/useEffectiveEntitlements";

type SavedEmbedSummary = {
  embedId: string;
  label: string;
  roomId: string;
  activeRoomId?: string | null;
};


type UsageData = {
  inRoomMinutes: number;
  maxInRoomMinutes: number;
  broadcastMinutes: number;
  maxBroadcastMinutes: number;
  storageUsed: number;
  maxStorage: number;
  planId: PlanId;
};

// Restrict display names to a safe, URL/log-friendly subset:
// letters, digits, space, hyphen, en dash, apostrophe, ampersand.
function sanitizeDisplayName(input: string): string {
  if (!input) return "";
  return input.replace(/[^A-Za-z0-9 \-–'&]/g, "");
}

function applyIncrementingSuffix(baseName: string, lastRoom: string | null): string {
  if (!lastRoom) return baseName;

  // If the last room exactly matches the base name, start at #2
  if (lastRoom === baseName) {
    return `${baseName} #2`;
  }

  // If the last room already has a numeric suffix and shares the same base, increment it
  const match = lastRoom.match(/^(.*) #(\d+)$/);
  if (match) {
    const [, priorBase, numStr] = match;
    if (priorBase === baseName) {
      const current = parseInt(numStr, 10);
      if (!Number.isNaN(current) && current >= 2) {
        return `${baseName} #${current + 1}`;
      }
    }
  }

  // Otherwise just use the base name
  return baseName;
}

function formatDefaultRoomName(displayName: string) {
  const now = new Date();
  const yyyy = String(now.getFullYear());
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const min = String(now.getMinutes()).padStart(2, "0");
  const stamp = `${yyyy}${mm}${dd}-${hh}${min}`;

  const prefix = displayName ? `${displayName} – Live` : "StreamLine Live";
  return `${prefix} – ${stamp}`;
}

export default function Join() {
  // Log auth/user info when arriving at join page
  useEffect(() => { logAuthDebugContext("Arrive Join Page"); }, []);
  const nav = useNavigate();
  const [searchParams] = useSearchParams();
  const { effectiveEntitlements } = useEffectiveEntitlements();
  const { access } = useFeatureAccess(effectiveEntitlements);
  const canContentLibrary = !!access?.contentLibrary?.allowed;
  const canProjects = !!access?.projects?.allowed;
  const canMyContent = !!access?.myContent?.allowed;
  const canMyContentRecordings = !!access?.myContentRecordings?.allowed;

  const myContentTarget = canProjects
    ? "/projects"
    : (canContentLibrary || canMyContentRecordings)
      ? "/content"
      : null;
  const showMyContentButton = !!myContentTarget && canMyContent;

  const [displayName, setDisplayName] = useState(() => {
    // Prefer profile displayName if available, then fall back to cached value
    try {
      const rawUser = localStorage.getItem("sl_user");
      if (rawUser && rawUser !== "undefined") {
        const parsed = JSON.parse(rawUser);
        if (parsed?.displayName) return sanitizeDisplayName(parsed.displayName as string);
      }
    } catch {
      // ignore parse errors and fall back
    }
    const cached = localStorage.getItem("sl_displayName") || "";
    return sanitizeDisplayName(cached);
  });
  const [didEditDisplayName, setDidEditDisplayName] = useState(false);
  const [roomName, setRoomName] = useState("");
  const [inviteRoomId, setInviteRoomId] = useState<string | null>(null);
  const [showLegacyJoinToast, setShowLegacyJoinToast] = useState(false);
  const [hideLegacyJoinToast, setHideLegacyJoinToast] = useState(() => {
    try {
      return localStorage.getItem("sl_hide_legacy_join_toast") === "true";
    } catch {
      return false;
    }
  });

  // Usage state
  const [usageData, setUsageData] = useState<UsageData | null>(null);
  const [usageLoading, setUsageLoading] = useState(false);
  const [usageError, setUsageError] = useState<string | null>(null);

  // Pull user from localStorage (existing behavior) - useState so it's stable
  const [user] = useState(() => {
    const raw = localStorage.getItem("sl_user");
    if (!raw || raw === "undefined") return null;
    try {
      return JSON.parse(raw);
    } catch (e) {
      localStorage.removeItem("sl_user");
      return null;
    }
  });

  // Invite handling:
  // - New flow: /join?t=... (preferred, roomId-based)
  // - Also accept /join?inviteToken=... for backward compatibility
  // - Legacy guest link: /join?room=... (guest/viewer style)
  const inviteTokenParam = searchParams.get("t") || searchParams.get("inviteToken");
  const legacyInviteRoomParam = searchParams.get("room");
  const isParticipant = !!inviteTokenParam || legacyInviteRoomParam !== null;

  // Saved Embeds (for hosts joining a Saved Room)
  const [savedEmbeds, setSavedEmbeds] = useState<SavedEmbedSummary[]>([]);
  const [savedEmbedsLoading, setSavedEmbedsLoading] = useState(false);
  const [savedEmbedsError, setSavedEmbedsError] = useState<string | null>(null);
  const [selectedSavedEmbedId, setSelectedSavedEmbedId] = useState<string>("");

  const [joinMode, setJoinMode] = useState<"new" | "saved">("new");

  // Platform-level HLS flag (controls enablement of Saved Room join when HLS is disabled)
  // Default to false so HLS-only UI is disabled until account flags load.
  const [platformHlsEnabled, setPlatformHlsEnabled] = useState<boolean>(false);

  // Use /api/auth/me for admin/test-mode status
  const { user: authUser, loading: authLoading } = useAuthMe();
  const isAdmin = !!authUser?.isAdmin;
  // Only show Admin UI for true admins. Test-mode or internal plans alone
  // are no longer sufficient to expose admin tools.
  const showAdminUi = !authLoading && isAdmin;
  const adminLoading = authLoading;

  // Auto-populate the name field from authenticated profile (test env often lacks sl_user localStorage)
  // Do not override if user has typed.
  useEffect(() => {
    if (didEditDisplayName) return;
    if (displayName.trim()) return;

    const candidate =
      (typeof authUser?.displayName === "string" && authUser.displayName.trim()) ||
      (typeof (authUser as any)?.name === "string" && String((authUser as any).name).trim()) ||
      (typeof authUser?.email === "string" && authUser.email.split("@")[0]?.trim()) ||
      "";

    if (!candidate) return;
    setDisplayName(sanitizeDisplayName(candidate));
    try {
      localStorage.setItem("sl_displayName", sanitizeDisplayName(candidate));
    } catch {
      // ignore
    }
  }, [authUser, didEditDisplayName, displayName]);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      // Preferred: inviteToken resolves room+role server-side
      if (inviteTokenParam) {
        try {
          console.log('[Join] Consolidated invite flow started');
          
          // Step 1: Resolve legacy token to inviteId
          const resolveRes = await fetch(`${API_BASE}/api/invites/legacy/resolve`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ inviteToken: inviteTokenParam }),
          });

          if (!resolveRes.ok) return;
          const resolveData = await resolveRes.json().catch(() => null as any);
          if (!resolveData || cancelled) return;

          const inviteId = String(resolveData?.inviteId || "").trim();
          if (!inviteId) return;
          
          console.log('[Join] Got inviteId, calling join-now:', inviteId);

          // Step 2: Call consolidated join-now endpoint (redeem + token mint in one call)
          const joinNowRes = await apiFetch(`/api/invites/${encodeURIComponent(inviteId)}/join-now`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({}),
          });

          if (!joinNowRes.ok) {
            // If join-now fails, fall back to old flow
            console.warn('[Join] Join-now failed, falling back to /invite page');
            nav(`/invite/${encodeURIComponent(inviteId)}`, { replace: true });
            return;
          }

          const joinData = await joinNowRes.json().catch(() => null as any);
          if (cancelled) return;

          const roomId = String(joinData?.roomId || "").trim();
          const guestSessionToken = String(joinData?.guestSessionToken || "").trim();
          const serverUrl = String(joinData?.serverUrl || "").trim();
          const roomToken = String(joinData?.roomToken || "").trim();
          const identity = String(joinData?.identity || "").trim();
          const displayName = String(joinData?.displayName || "").trim();

          if (!roomId || !serverUrl || !roomToken) {
            // Fall back to old flow if missing critical data
            console.warn('[Join] Missing critical data, falling back to /invite page');
            nav(`/invite/${encodeURIComponent(inviteId)}`, { replace: true });
            return;
          }

          console.log('[Join] Consolidated flow complete, going to room with pre-fetched token:', roomId);

          // Store guest session token in multiple places (redundant storage for reliability)
          if (guestSessionToken) {
            try {
              sessionStorage.setItem(`sl_guest_session:${roomId}`, guestSessionToken);
              localStorage.setItem("sl_guestSessionToken", guestSessionToken);
              localStorage.setItem("sl_guestSessionRoomId", roomId);
            } catch {
              // ignore storage errors
            }
          }

          // Store pre-fetched LiveKit credentials (eliminates token fetch in Room.tsx)
          if (serverUrl && roomToken && identity) {
            try {
              const tokenData = {
                serverUrl,
                token: roomToken,
                identity,
                displayName,
                fetchedAt: Date.now(),
              };
              sessionStorage.setItem(`sl_lk_token:${roomId}`, JSON.stringify(tokenData));
              console.log('[Join] Stored pre-fetched LiveKit token for room:', roomId);
            } catch {
              // ignore storage errors
            }
          }

          // Step 3: Go directly to room with guest session token
          // Room.tsx will use pre-fetched token data, eliminating token fetch delay
          const urlToken = guestSessionToken ? `?gst=${encodeURIComponent(guestSessionToken)}` : "";
          nav(`/room/${encodeURIComponent(roomId)}${urlToken}`, { replace: true });
          return;
        } catch (err) {
          console.error('[Join] Consolidated flow error:', err);
          return;
        }
      }

      // Legacy: /join?room=... (treat as guest)
      if (legacyInviteRoomParam) {
        const decodedRoom = decodeURIComponent(legacyInviteRoomParam);
        setRoomName(decodedRoom);
        try {
          localStorage.removeItem("sl_invite_token");
          localStorage.setItem("sl_current_role", "guest");
        } catch {
          // ignore
        }
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [inviteTokenParam, legacyInviteRoomParam]);

  // Load platform-level flags to know if HLS (and Saved Rooms join) should be available.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await apiFetchAuth(`${API_BASE}/api/account/me`, {}, { allowNonOk: true });
        if (!res.ok) {
          if (!cancelled) setPlatformHlsEnabled(true);
          return;
        }
        const me = await res.json().catch(() => null);
        if (cancelled || !me) {
          return;
        }
        const platformFlags = (me as any)?.platformFlags || {};
        if (typeof platformFlags.hlsEnabled === "boolean") {
          setPlatformHlsEnabled(platformFlags.hlsEnabled);
        } else {
          setPlatformHlsEnabled(true);
        }
      } catch {
        if (!cancelled) setPlatformHlsEnabled(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const lastRoom = useMemo(() => {
    try {
      const raw = localStorage.getItem("sl_last_room");
      const ts = Number(localStorage.getItem("sl_last_room_ts") || 0);
      if (!raw || !ts) return null;
      const ageMs = Date.now() - ts;
      // Only suggest reuse if within 6 hours
      if (ageMs > 6 * 60 * 60 * 1000) return null;
      return raw;
    } catch {
      return null;
    }
  }, []);

  // Load Saved Embeds for host flow so they can optionally
  // bind the room to a Saved Embed at creation time.
  useEffect(() => {
    if (isParticipant) return;

    let cancelled = false;
    (async () => {
      setSavedEmbedsLoading(true);
      setSavedEmbedsError(null);
      try {
        const res = await apiFetchAuth(`${API_BASE}/api/saved-embeds`, {
          method: "GET",
          cache: "no-store",
        }, { allowNonOk: true });
        const payload = await res.json().catch(() => null);
        if (!res.ok) {
          throw new Error(payload?.error || "Failed to load Saved Rooms");
        }
        if (cancelled) return;
        const list = Array.isArray(payload?.embeds) ? payload.embeds : [];
        const next: SavedEmbedSummary[] = list
          .map((e: any) => ({
            embedId: String(e?.embedId || "").trim(),
            label: String(e?.label || "").trim(),
            roomId: String(e?.roomId || "").trim(),
            activeRoomId: typeof e?.activeRoomId === "string" ? e.activeRoomId : null,
          }))
          .filter((e) => !!e.embedId && !!e.roomId);
        setSavedEmbeds(next);
      } catch (e: any) {
        if (!cancelled) {
          setSavedEmbedsError(e?.message || "Failed to load Saved Rooms");
          setSavedEmbeds([]);
        }
      } finally {
        if (!cancelled) setSavedEmbedsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isParticipant]);

  useEffect(() => {
    if (isParticipant) return; // never override invite room
    if (roomName.trim()) return; // respect user edits

    const baseName = formatDefaultRoomName(displayName.trim());
    const nextName = applyIncrementingSuffix(baseName, lastRoom);
    setRoomName(nextName);
  }, [displayName, isParticipant, lastRoom, roomName]);

  // Fetch real usage summary (for all authenticated users)
  useEffect(() => {
    let didCancel = false;
   

    setUsageLoading(true);
    setUsageError(null);

    apiFetchAuth(`${API_BASE}/api/usage/me`, {}, { allowNonOk: true })
  .then(async (res) => {
    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || "Failed to fetch usage data");
    }
    return res.json();
  })
  .then((data) => {
    if (!didCancel) {
      const um = data?.usageMonthly || {};
      const minutes = data?.usage?.minutes || um?.usage?.minutes || {};
      // Canonicalize plan id
      let planIdRaw = data?.plan?.id ?? data?.user?.planId ?? "free";
      let canonicalPlanId: PlanId = "free";
      if (planIdRaw === "starter_paid" || planIdRaw === "starter_trial") {
        canonicalPlanId = "starter";
      } else if (isPlanId(planIdRaw)) {
        canonicalPlanId = planIdRaw;
      }
      setUsageData({
        inRoomMinutes:
          minutes?.inRoom?.currentPeriod ??
          um?.participantMinutes ??
          um?.usage?.participantMinutes ??
          Math.max(0, Math.round((data?.user?.usage?.hoursStreamedThisMonth || 0) * 60)),
        maxInRoomMinutes: data?.plan?.limits?.participantMinutes ?? 0,
        broadcastMinutes:
          minutes?.broadcast?.currentPeriod ??
          minutes?.transcode?.currentPeriod ??
          um?.transcodeMinutes ??
          um?.usage?.transcodeMinutes ??
          0,
        maxBroadcastMinutes: data?.plan?.limits?.transcodeMinutes ?? 0,
        storageUsed: um?.storageGB ?? um?.usage?.storageGB ?? 0,
        maxStorage: data?.plan?.limits?.storageGB ?? 0,
        planId: canonicalPlanId,
      });
      setUsageLoading(false);
    }
  })
      .catch((err) => {
        if (!didCancel) {
          setUsageError(err.message || "Failed to fetch usage data");
          setUsageLoading(false);
        }
      });
    return () => {
      didCancel = true;
    };
  }, [user]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const name = sanitizeDisplayName(displayName).trim();
    if (!name) {
      alert("Please enter a valid name using letters, numbers, spaces, -, –, ', & only.");
      return;
    }

    const roomLabel = roomName.trim();

    const isUsingSaved = !isParticipant && joinMode === "saved";
    if (isUsingSaved && !selectedSavedEmbedId) {
      alert("Select a Saved Room or switch to Create New Room.");
      return;
    }

    localStorage.setItem("sl_displayName", name);

    // For invite-based joins, mark that the guest is proceeding into the room.
    if (isParticipant && inviteTokenParam) {
      try {
        fetch(`${API_BASE}/api/invites/track-landing`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ inviteToken: inviteTokenParam, stage: "entered_room" }),
        }).catch(() => {});
      } catch {
        // best-effort only
      }
    }

    // Host flow: create a Firestore room first, then navigate to /room/:roomId
    if (!isParticipant) {
      try {
        // Saved Room flow (HLS): reuse the existing canonical roomId so
        // HLS config + viewer page stay stable across sessions.
        if (isUsingSaved) {
          const selected = savedEmbeds.find((e) => e.embedId === selectedSavedEmbedId);
          const savedRoomId = String(selected?.roomId || "").trim();
          if (!savedRoomId) {
            alert("Select a Saved Room or switch to Create New Room.");
            return;
          }

          // Ensure this room is treated as host-created on this device so
          // the Room page can mint host tokens even when the room is idle.
          try {
            const createdRooms = JSON.parse(localStorage.getItem("sl_created_rooms") || "[]");
            if (!createdRooms.includes(savedRoomId)) {
              createdRooms.push(savedRoomId);
              localStorage.setItem("sl_created_rooms", JSON.stringify(createdRooms));
            }
          } catch {
            // ignore
          }

          localStorage.setItem("sl_last_room", selected?.label || roomLabel || savedRoomId);
          localStorage.setItem("sl_last_room_ts", String(Date.now()));
          localStorage.setItem("sl_current_role", "host");

          nav(`/room/${encodeURIComponent(savedRoomId)}`);
          return;
        }

        if (!roomLabel) {
          alert("Please enter a room name.");
          return;
        }

        const res = await apiFetchAuth(`${API_BASE}/api/rooms/create`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            livekitRoomName: roomLabel,
            roomType: "rtc",
            savedEmbedId: undefined,
          }),
        }, { allowNonOk: true });

        if (!res.ok) {
          const text = await res.text().catch(() => "");
          console.error("Failed to create room", res.status, text);

          alert("Failed to create room. Please try again.");
          return;
        }

        const data = await res.json().catch(() => null as any);
        const roomId = String(data?.roomId || "").trim();
        const livekitRoomName = String(data?.livekitRoomName || roomLabel).trim();

        if (!roomId) {
          console.error("Missing roomId in /api/rooms/create response", data);
          alert("Failed to create room. Please try again.");
          return;
        }

        // Mark this room as created by this user using the Firestore roomId
        const createdRooms = JSON.parse(localStorage.getItem("sl_created_rooms") || "[]");
        if (!createdRooms.includes(roomId)) {
          createdRooms.push(roomId);
          localStorage.setItem("sl_created_rooms", JSON.stringify(createdRooms));
        }

        localStorage.setItem("sl_last_room", livekitRoomName);
        localStorage.setItem("sl_last_room_ts", String(Date.now()));
        localStorage.setItem("sl_current_role", "host");

        nav(`/room/${encodeURIComponent(roomId)}`, {
          state: { livekitRoomName },
        });
        return;
      } catch (err) {
        console.error("Error creating room", err);
        alert("Failed to create room. Please try again.");
        return;
      }
    }

    // Participant / invite flows:
    // Prefer roomId-based navigation when we have an invite token.
    if (isParticipant && inviteTokenParam && inviteRoomId) {
      nav(`/room/${encodeURIComponent(inviteRoomId)}?t=${encodeURIComponent(inviteTokenParam)}`);
      return;
    }

    // Legacy fallback: room name based join (to be fully removed later)
    if (!hideLegacyJoinToast) {
      setShowLegacyJoinToast(true);
      console.log("[Join] Legacy room-name join fallback", { roomName: roomLabel });
      try {
        fetch(`${API_BASE}/api/telemetry/event`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            event: "legacy_roomname_join_attempt",
            roomName: roomLabel,
            source: "join",
            ts: Date.now(),
          }),
        }).catch((err) => {
          console.warn("Failed to send telemetry event", err);
        });
      } catch (err) {
        console.warn("Error scheduling telemetry event", err);
      }
    }

    nav(`/room/${encodeURIComponent(roomLabel)}`);
  }

  const streamingPercent =
    usageData && usageData.maxInRoomMinutes > 0
      ? (usageData.inRoomMinutes / usageData.maxInRoomMinutes) * 100
      : 0;

  const broadcastPercent =
    usageData && usageData.maxBroadcastMinutes > 0
      ? (usageData.broadcastMinutes / usageData.maxBroadcastMinutes) * 100
      : 0;

  const storagePercent =
    usageData && usageData.maxStorage > 0
      ? (usageData.storageUsed / usageData.maxStorage) * 100
      : 0;

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "#000000",
        color: "#ffffff",
        padding: "24px",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* ANIMATED BACKGROUND */}
      <div style={{ position: "absolute", inset: 0, zIndex: 0 }}>
        <div
          style={{
            position: "absolute",
            top: "20%",
            right: "15%",
            width: "500px",
            height: "500px",
            background: "rgba(220, 38, 38, 0.15)",
            borderRadius: "50%",
            filter: "blur(120px)",
            animation: "pulse 4s ease-in-out infinite",
          }}
        />
        <div
          style={{
            position: "absolute",
            bottom: "20%",
            left: "15%",
            width: "600px",
            height: "600px",
            background: "rgba(239, 68, 68, 0.1)",
            borderRadius: "50%",
            filter: "blur(150px)",
            animation: "pulse 4s ease-in-out infinite",
            animationDelay: "2s",
          }}
        />
      </div>

      {/* USAGE BANNER - TOP BAR - For all authenticated users */}
      {user && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            zIndex: 30,
            background: "rgba(15, 15, 15, 0.9)",
            backdropFilter: "blur(20px)",
            borderBottom: "1px solid rgba(255, 255, 255, 0.1)",
            padding: "16px 24px",
          }}
        >
          <div
            style={{
              maxWidth: "1200px",
              margin: "0 auto",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "24px",
              flexWrap: "wrap",
            }}
          >
            {/* Usage Stats */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "32px",
                flexWrap: "wrap",
              }}
            >
              {/* In-room minutes */}
              <div>
                <div
                  style={{
                    fontSize: "11px",
                    color: "#6b7280",
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                    marginBottom: "4px",
                  }}
                >
                  Streaming minutes
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <div style={{ fontSize: "18px", fontWeight: 700 }}>
                    {usageLoading
                      ? "..."
                      : usageError
                      ? "—"
                      : usageData?.inRoomMinutes ?? "—"}
                  </div>
                  <div style={{ fontSize: "13px", color: "#9ca3af" }}>
                    /{" "}
                    {usageLoading
                      ? "..."
                      : usageError
                      ? "—"
                      : usageData?.maxInRoomMinutes ?? "—"}
                  </div>
                </div>
                <div
                  style={{
                    width: "120px",
                    height: "4px",
                    background: "rgba(255, 255, 255, 0.1)",
                    borderRadius: "2px",
                    marginTop: "4px",
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      height: "100%",
                      width: `${streamingPercent}%`,
                      background: "linear-gradient(to right, #dc2626, #ef4444)",
                      borderRadius: "2px",
                    }}
                  />
                </div>
              </div>

              {/* Broadcast minutes (only when plan includes broadcast/transcode) */}
              {usageData && usageData.maxBroadcastMinutes > 0 && (
                <div>
                  <div
                    style={{
                      fontSize: "11px",
                      color: "#6b7280",
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                      marginBottom: "4px",
                    }}
                  >
                    Broadcast minutes
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <div style={{ fontSize: "18px", fontWeight: 700 }}>
                      {usageLoading
                        ? "..."
                        : usageError
                        ? "—"
                        : usageData?.broadcastMinutes ?? "—"}
                    </div>
                    <div style={{ fontSize: "13px", color: "#9ca3af" }}>
                      /{" "}
                      {usageLoading
                        ? "..."
                        : usageError
                        ? "—"
                        : usageData?.maxBroadcastMinutes ?? "—"}
                    </div>
                  </div>
                  <div style={{ marginTop: 6, fontSize: 12, color: "#94a3b8" }}>
                    Broadcasting uses broadcast minutes.
                  </div>
                  <div
                    style={{
                      width: "120px",
                      height: "4px",
                      background: "rgba(255, 255, 255, 0.1)",
                      borderRadius: "2px",
                      marginTop: "4px",
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        height: "100%",
                        width: `${broadcastPercent}%`,
                        background: "linear-gradient(to right, #a855f7, #8b5cf6)",
                        borderRadius: "2px",
                      }}
                    />
                  </div>
                </div>
              )}

              {/* Storage Used */}
              <div>
                <div
                  style={{
                    fontSize: "11px",
                    color: "#6b7280",
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                    marginBottom: "4px",
                  }}
                >
                  Storage Used
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <div style={{ fontSize: "18px", fontWeight: 700 }}>
                    {usageLoading
                      ? "..."
                      : usageError
                      ? "—"
                      : usageData?.storageUsed ?? "—"}{" "}
                    GB
                  </div>
                  <div style={{ fontSize: "13px", color: "#9ca3af" }}>
                    /{" "}
                    {usageLoading
                      ? "..."
                      : usageError
                      ? "—"
                      : usageData?.maxStorage ?? "—"}{" "}
                    GB
                  </div>
                </div>
                <div
                  style={{
                    width: "120px",
                    height: "4px",
                    background: "rgba(255, 255, 255, 0.1)",
                    borderRadius: "2px",
                    marginTop: "4px",
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      height: "100%",
                      width: `${storagePercent}%`,
                      background: "linear-gradient(to right, #dc2626, #ef4444)",
                      borderRadius: "2px",
                    }}
                  />
                </div>
              </div>

              {/* Plan Badge */}
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <div
                  style={{
                    padding: "6px 12px",
                    background: "rgba(220, 38, 38, 0.2)",
                    border: "1px solid rgba(220, 38, 38, 0.4)",
                    borderRadius: "8px",
                    fontSize: "12px",
                    fontWeight: 600,
                    textTransform: "uppercase",
                  }}
                >
                  {usageLoading
                    ? "Loading..."
                    : usageError
                    ? "—"
                    : usageData?.planId
                    ? `${usageData.planId} Plan`
                    : "—"}
                </div>

                {/* Upgrade button removed */}
              </div>

              {/* Error message under usage stats */}
              {/* Only show Admin Dashboard button for actual admins. No fallback for non-admins. */}
              {usageError && (
                <button
                  style={{
                    marginTop: "8px",
                    background: "rgba(220, 38, 38, 0.15)",
                    border: "1px solid #ef4444",
                    color: "#ef4444",
                    borderRadius: "6px",
                    padding: "6px 16px",
                    fontSize: "13px",
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                  disabled
                  title={usageError}
                >
                  {usageError}
                </button>
              )}
            </div>

            {/* Right side actions */}
            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              {/* Settings & Billing button, always visible to logged-in users */}
              <button
                onClick={() => nav("/settings/billing")}
                style={{
                  fontSize: "13px",
                  padding: "8px 16px",
                  background: "rgba(255,255,255,0.05)",
                  border: "1px solid rgba(255,255,255,0.2)",
                  color: "#fff",
                  borderRadius: "8px",
                  fontWeight: 600,
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                  transition: "all 0.3s ease",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "rgba(255,255,255,0.1)";
                  e.currentTarget.style.borderColor = "rgba(34,197,94,0.6)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "rgba(255,255,255,0.05)";
                  e.currentTarget.style.borderColor = "rgba(255,255,255,0.2)";
                }}
              >
                ⚙️ Settings & Billing
              </button>

              {showMyContentButton && (
                <button
                  onClick={() => nav(myContentTarget)}
                  title="Open your content"
                  style={{
                    fontSize: "13px",
                    padding: "8px 16px",
                    background: "rgba(220, 38, 38, 0.1)",
                    border: "1px solid rgba(220, 38, 38, 0.4)",
                    borderRadius: "8px",
                    color: "#ef4444",
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                    transition: "all 0.3s ease",
                    fontWeight: 500,
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "rgba(220, 38, 38, 0.2)";
                    e.currentTarget.style.borderColor = "rgba(220, 38, 38, 0.8)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "rgba(220, 38, 38, 0.1)";
                    e.currentTarget.style.borderColor = "rgba(220, 38, 38, 0.4)";
                  }}
                >
                  🎬 My Content
                </button>
              )}

              {isAdmin && (
                <button
                  onClick={() => nav("/admin/dashboard")}
                  style={{
                    fontSize: "13px",
                    padding: "8px 16px",
                    background: "rgba(220, 38, 38, 0.15)",
                    border: "1px solid rgba(220, 38, 38, 0.5)",
                    borderRadius: "8px",
                    color: "#ef4444",
                    cursor: "pointer",
                    fontWeight: 600,
                    whiteSpace: "nowrap",
                  }}
                >
                  🛠 Admin Dashboard
                </button>
              )}
            </div>

              
      </div>
    </div>
  )}


      <div
        style={{
          position: "relative",
          zIndex: 10,
          width: "100%",
          maxWidth: "480px",
          marginTop: isParticipant ? "0px" : "80px",
        }}
      >
        {/* LOGO */}
        <div style={{ marginBottom: "32px", textAlign: "center" }}>
          <img
            src="/logo.png"
            alt="StreamLine Logo"
            style={{
              width: "320px",
              height: "320px",
              margin: "0 auto",
              filter: "drop-shadow(0 0 25px rgba(220, 38, 38, 0.5))",
            }}
          />
        </div>

        {/* WELCOME MESSAGE */}
        {user && (
          <div style={{ marginBottom: "32px", textAlign: "center" }}>
            <h2
              style={{
                fontSize: "28px",
                fontWeight: 700,
                marginBottom: "8px",
                background: "linear-gradient(to right, #ffffff, #fecaca, #ffffff)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
              }}
            >
              Welcome back, {user.displayName || user.email}! 👋
            </h2>
            {user.defaultResolution && (
              <p style={{ fontSize: "14px", color: "#6b7280" }}>
                Default resolution: {user.defaultResolution}
              </p>
            )}
          </div>
        )}

        {!user && (
          <div style={{ marginBottom: "32px", textAlign: "center" }}>
            <h1
              style={{
                fontSize: "32px",
                fontWeight: 700,
                marginBottom: "8px",
                background: "linear-gradient(to right, #ffffff, #fecaca, #ffffff)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
              }}
            >
              Join Room
            </h1>
            <p style={{ fontSize: "16px", color: "#9ca3af" }}>
              Once you enter the room, click the camera and mic icons.
            </p>
          </div>
        )}

        {/* FORM CONTAINER */}
        <div
          style={{
            background: "rgba(15, 15, 15, 0.7)",
            backdropFilter: "blur(20px)",
            border: "1px solid rgba(255, 255, 255, 0.1)",
            borderRadius: "20px",
            padding: "32px",
            marginBottom: "24px",
          }}
        >
          <form onSubmit={handleSubmit}>
            {/* DISPLAY NAME */}
            <div style={{ marginBottom: "20px" }}>
              <label
                style={{
                  display: "block",
                  fontSize: "13px",
                  fontWeight: 500,
                  color: "#9ca3af",
                  marginBottom: "8px",
                }}
              >
                Your Name
              </label>
              <input
                type="text"
                placeholder="Enter your display name"
                value={displayName}
                onChange={(e) => {
                  setDidEditDisplayName(true);
                  const safe = sanitizeDisplayName(e.target.value);
                  setDisplayName(safe);
                }}
                required
                style={{
                  width: "100%",
                  padding: "14px 16px",
                  background: "rgba(0, 0, 0, 0.4)",
                  border: "1px solid rgba(255, 255, 255, 0.1)",
                  borderRadius: "12px",
                  color: "#ffffff",
                  fontSize: "15px",
                  outline: "none",
                }}
              />
            </div>

            {/* ROOM NAME (hosts only; participants never edit this) */}
            {!isParticipant && !searchParams.get("room") && (
              <div style={{ marginBottom: "24px" }}>
                <label
                  style={{
                    display: "block",
                    fontSize: "13px",
                    fontWeight: 500,
                    color: "#9ca3af",
                    marginBottom: "8px",
                  }}
                >
                  Room Name
                </label>
                <input
                  type="text"
                  placeholder="Enter room name"
                  value={roomName}
                  onChange={(e) => setRoomName(e.target.value)}
                  required
                  style={{
                    width: "100%",
                    padding: "14px 16px",
                    background: "rgba(0, 0, 0, 0.4)",
                    border: "1px solid rgba(255, 255, 255, 0.1)",
                    borderRadius: "12px",
                    color: "#ffffff",
                    fontSize: "15px",
                    outline: "none",
                  }}
                />
              </div>
            )}

            {/* HOST JOIN MODE TOGGLE (only shown when platform HLS/Saved Rooms join is enabled) */}
            {!isParticipant && platformHlsEnabled && savedEmbeds.length > 0 && (
              <div style={{ marginBottom: "20px" }}>
                <div style={{ fontSize: "12px", color: "#9ca3af", marginBottom: "6px" }}>Join mode</div>
                <div
                  style={{
                    display: "inline-flex",
                    padding: "3px",
                    borderRadius: "999px",
                    background: "rgba(15,23,42,0.85)",
                    border: "1px solid rgba(55,65,81,0.9)",
                    gap: "4px",
                  }}
                >
                  <button
                    type="button"
                    onClick={() => setJoinMode("new")}
                    style={{
                      padding: "6px 10px",
                      borderRadius: "999px",
                      border: "none",
                      fontSize: "12px",
                      cursor: "pointer",
                      background: joinMode === "new" ? "#f97316" : "transparent",
                      color: joinMode === "new" ? "#111827" : "#e5e7eb",
                      fontWeight: joinMode === "new" ? 700 : 500,
                    }}
                  >
                    Create New Room
                  </button>
                  <button
                    type="button"
                    disabled={!platformHlsEnabled || savedEmbeds.length === 0}
                    onClick={() => {
                      if (!platformHlsEnabled || savedEmbeds.length === 0) return;
                      setJoinMode("saved");
                    }}
                    style={{
                      padding: "6px 10px",
                      borderRadius: "999px",
                      border: "none",
                      fontSize: "12px",
                      cursor:
                        !platformHlsEnabled || savedEmbeds.length === 0 ? "not-allowed" : "pointer",
                      background: joinMode === "saved" ? "#f97316" : "transparent",
                      color:
                        !platformHlsEnabled || savedEmbeds.length === 0
                          ? "#6b7280"
                          : joinMode === "saved"
                          ? "#111827"
                          : "#e5e7eb",
                      fontWeight: joinMode === "saved" ? 700 : 500,
                      opacity: !platformHlsEnabled || savedEmbeds.length === 0 ? 0.5 : 1,
                    }}
                  >
                    Use Saved Room
                  </button>
                </div>
              </div>
            )}

            {/* HOST: Saved Room selector when using saved mode (only when platform HLS is enabled) */}
            {!isParticipant && platformHlsEnabled && savedEmbeds.length > 0 && joinMode === "saved" && (
              <div style={{ marginBottom: "24px" }}>
                <label
                  style={{
                    display: "block",
                    fontSize: "13px",
                    fontWeight: 500,
                    color: "#9ca3af",
                    marginBottom: "8px",
                  }}
                >
                  Saved Room
                </label>
                <select
                  value={selectedSavedEmbedId}
                  onChange={(e) => setSelectedSavedEmbedId(e.target.value)}
                  disabled={savedEmbedsLoading}
                  style={{
                    width: "100%",
                    padding: "12px 14px",
                    background: "#ffffff",
                    border: "1px solid rgba(255, 255, 255, 0.1)",
                    borderRadius: "12px",
                    color: "#000000",
                    fontSize: "14px",
                    outline: "none",
                  }}
                >
                  <option
                    value=""
                    style={{ color: "#000000", backgroundColor: "#ffffff" }}
                  >
                    Select a Saved Room…
                  </option>
                  {savedEmbeds.map((embed) => (
                    <option
                      key={embed.embedId}
                      value={embed.embedId}
                      style={{ color: "#000000", backgroundColor: "#ffffff" }}
                    >
                      {embed.label || embed.embedId}
                      {embed.activeRoomId ? " (Active)" : ""}
                    </option>
                  ))}
                </select>
                {selectedSavedEmbedId && (
                  <div style={{ marginTop: "6px", fontSize: "12px", color: "#9ca3af" }}>
                    This will broadcast to: <span style={{ color: "#e5e7eb" }}>/live/{selectedSavedEmbedId}</span>
                  </div>
                )}
                {savedEmbedsError && (
                  <div style={{ marginTop: "6px", fontSize: "12px", color: "#fecaca" }}>
                    {savedEmbedsError}
                  </div>
                )}
              </div>
            )}

            {/* SUBMIT BUTTON */}
            <button
              type="submit"
              style={{
                width: "100%",
                padding: "16px",
                background: "linear-gradient(to right, #dc2626, #ef4444)",
                color: "#ffffff",
                border: "none",
                borderRadius: "12px",
                fontSize: "16px",
                fontWeight: 600,
                cursor: "pointer",
                boxShadow: "0 8px 32px rgba(220, 38, 38, 0.3)",
                transition: "all 0.3s ease",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background =
                  "linear-gradient(to right, #ef4444, #f87171)";
                e.currentTarget.style.transform = "translateY(-2px)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background =
                  "linear-gradient(to right, #dc2626, #ef4444)";
                e.currentTarget.style.transform = "translateY(0)";
              }}
            >
              Enter Room
            </button>
          </form>
        </div>

        {/* Streaming setup hint - hosts only */}
        {!isParticipant && (
          <div
            style={{
              marginBottom: "24px",
              fontSize: "12px",
              color: "#9ca3af",
              textAlign: "center",
            }}
          >
            Suggested room name: <strong>{roomName || "StreamLine Live"}</strong>
            <div style={{ marginTop: "6px" }}>
              Want one-click Go Live to YouTube, Facebook, or Twitch?
              {" "}
              <button
                type="button"
                onClick={() => nav("/settings/billing?tab=destinations")}
                style={{
                  marginLeft: "4px",
                  fontSize: "12px",
                  color: "#f97316",
                  textDecoration: "underline",
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  padding: 0,
                }}
              >
                Configure streaming settings
              </button>
            </div>
          </div>
        )}

        {/* LOGOUT BUTTON */}
        <div style={{ textAlign: "center" }}>
          <button
            onClick={async () => {
              try {
                await apiFetch("/api/auth/logout", { method: "POST" }, { allowNonOk: true });
              } catch {
                // ignore network errors; we'll still clear client state
              }
              try {
                clearAuthStorage();
                localStorage.removeItem("sl_displayName");
                localStorage.removeItem("sl_created_rooms");
                localStorage.removeItem("sl_current_role");
                localStorage.removeItem("sl_invite_token");
                localStorage.removeItem("sl_guestId");
                localStorage.removeItem("sl_last_room");
              } catch {
                // best-effort only
              }
              window.location.href = "/";
            }}
            style={{
              fontSize: "13px",
              padding: "8px 16px",
              border: "1px solid rgba(220, 38, 38, 0.5)",
              background: "transparent",
              color: "#ef4444",
              borderRadius: "8px",
              cursor: "pointer",
              transition: "all 0.3s ease",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "rgba(220, 38, 38, 0.2)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "transparent";
            }}
          >
            Logout
          </button>
        </div>
      </div>

      {/* Legacy room-name join deprecation toast */}
      {showLegacyJoinToast && !hideLegacyJoinToast && (
        <div
          style={{
            position: "fixed",
            bottom: 24,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 40,
            maxWidth: "520px",
            width: "calc(100% - 32px)",
            background: "rgba(15,15,15,0.95)",
            borderRadius: "12px",
            border: "1px solid rgba(248,113,113,0.5)",
            boxShadow: "0 20px 40px rgba(0,0,0,0.6)",
            padding: "14px 16px",
            display: "flex",
            alignItems: "flex-start",
            gap: "12px",
          }}
        >
          <div
            style={{
              width: "32px",
              height: "32px",
              borderRadius: "999px",
              background: "rgba(248,113,113,0.15)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <span style={{ fontSize: "18px" }}>⚠️</span>
          </div>
          <div style={{ flex: 1 }}>
            <div
              style={{
                fontSize: "14px",
                fontWeight: 600,
                marginBottom: "4px",
              }}
            >
              Heads up
            </div>
            <div
              style={{
                fontSize: "13px",
                color: "#e5e7eb",
                marginBottom: "8px",
              }}
            >
              Heads up: joining by room name is being phased out. Ask the host for an invite link.
            </div>
            <label
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                fontSize: "12px",
                color: "#9ca3af",
                cursor: "pointer",
                userSelect: "none",
              }}
            >
              <input
                type="checkbox"
                checked={hideLegacyJoinToast}
                onChange={(e) => {
                  const next = e.target.checked;
                  setHideLegacyJoinToast(next);
                  try {
                    if (next) {
                      localStorage.setItem("sl_hide_legacy_join_toast", "true");
                    } else {
                      localStorage.removeItem("sl_hide_legacy_join_toast");
                    }
                  } catch {
                    // ignore
                  }
                }}
                style={{
                  width: "14px",
                  height: "14px",
                  borderRadius: "4px",
                }}
              />
              Don't show again
            </label>
          </div>
          <button
            type="button"
            onClick={() => setShowLegacyJoinToast(false)}
            aria-label="Dismiss legacy join warning"
            style={{
              border: "none",
              background: "transparent",
              color: "#9ca3af",
              cursor: "pointer",
              padding: 0,
              marginLeft: "4px",
              fontSize: "16px",
            }}
          >
            ×
          </button>
        </div>
      )}

      {/* CSS ANIMATIONS */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 0.15; transform: scale(1); }
          50% { opacity: 0.25; transform: scale(1.05); }
        }
      `}</style>
    </div>
  );
}
