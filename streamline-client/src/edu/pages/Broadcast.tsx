import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useLocation } from "react-router-dom";
import { useEduMe } from "../layout/EduProtectedRoute";
import { getEduEventById, setEduEventLive } from "../state/eduEvents";
import { fetchEduOrg, postEduAudit, type EduOrgSettings } from "../api/settings";
import { goLiveEduBroadcast, stopEduBroadcast, watchEduBroadcast, type GoLiveResponse } from "../api/broadcasts";
import { isEduBypassEnabled } from "../state/eduMode";

const DEMO_MAX_BROADCAST_MS = 5 * 60 * 1000; // 5 minutes

type BroadcastTemplateId = "announcements" | "event" | "principal";
type LayoutMode = "grid" | "speaker" | "single";

type OutputStatus = "off" | "starting" | "active" | "error";

type Talent = {
  id: string;
  name: string;
  micMuted: boolean;
  camOff: boolean;
};

function randomId(prefix: string) {
  try {
    const id = crypto?.randomUUID?.();
    if (id) return `${prefix}_${id.slice(0, 8)}`;
  } catch {
    // ignore
  }
  return `${prefix}_${Math.random().toString(16).slice(2, 10)}`;
}

function formatElapsed(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function Toggle({
  checked,
  onChange,
  disabled,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label: string;
  hint?: string;
}) {
  return (
    <button
      type="button"
      disabled={!!disabled}
      onClick={() => onChange(!checked)}
      className={`flex w-full items-center justify-between gap-4 rounded-xl border p-4 text-left transition-colors ${
        disabled
          ? "cursor-not-allowed border-slate-800/50 bg-slate-900/20 opacity-60"
          : "border-slate-700 bg-gradient-to-br from-slate-800 to-slate-800/50 hover:border-slate-600/70"
      }`}
    >
      <div className="min-w-0">
        <div className="font-medium text-white">{label}</div>
        {hint ? <div className="mt-1 text-sm text-slate-400">{hint}</div> : null}
      </div>
      <div
        aria-hidden
        className={`relative h-6 w-11 flex-shrink-0 rounded-full transition-colors ${
          checked ? "bg-orange-500" : "bg-slate-700"
        }`}
      >
        <div
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
            checked ? "translate-x-5" : "translate-x-0.5"
          }`}
        />
      </div>
    </button>
  );
}

function StatusChip({ label, status }: { label: string; status: OutputStatus }) {
  const { text, cls } = useMemo(() => {
    if (status === "active") return { text: "✅ Active", cls: "bg-emerald-500/15 text-emerald-300 border-emerald-500/20" };
    if (status === "starting") return { text: "⏳ Starting", cls: "bg-amber-500/15 text-amber-300 border-amber-500/20" };
    if (status === "error") return { text: "❌ Error", cls: "bg-red-500/15 text-red-300 border-red-500/20" };
    return { text: "Off", cls: "bg-slate-800/50 text-slate-400 border-slate-700/30" };
  }, [status]);

  return (
    <div className={`flex items-center justify-between gap-3 rounded-xl border px-4 py-3 ${cls}`}>
      <div className="text-sm font-medium">{label}</div>
      <div className="text-sm">{text}</div>
    </div>
  );
}

export default function Broadcast() {
  const me = useEduMe();
  const loc = useLocation();
  const roleRaw = String(me?.orgRole || me?.role || "viewer");

  const isFacultyAdmin = roleRaw === "faculty_admin";
  const isStudentProducer = roleRaw === "student_producer" || roleRaw === "student_producer_assigned";
  const isTalent = roleRaw === "talent";
  const isViewer = roleRaw === "viewer";

  const canSeePage = isFacultyAdmin || isStudentProducer;
  if (!me || !canSeePage || isTalent || isViewer) {
    return (
      <div className="rounded-2xl border border-slate-700 bg-gradient-to-br from-slate-800 to-slate-800/50 p-6 text-slate-200">
        <div className="text-lg font-semibold text-white">No access</div>
        <div className="mt-2 text-sm text-slate-400">
          This page is only available to Faculty/Admin and approved Student Producers.
        </div>
      </div>
    );
  }

  const displayName = String(me.displayName || "You");

  const templates = useMemo(
    () =>
      [
        {
          id: "announcements" as const,
          title: "Morning Announcements",
          desc: "Daily updates and headlines",
          defaults: {
            layout: "speaker" as LayoutMode,
            publishHls: true,
            recordMp4: false,
            youtube: false,
            viewers: "school" as "school" | "link",
          },
        },
        {
          id: "event" as const,
          title: "Live Event",
          desc: "Sports, concerts, assemblies",
          defaults: {
            layout: "grid" as LayoutMode,
            publishHls: true,
            recordMp4: true,
            youtube: false,
            viewers: "school" as "school" | "link",
          },
        },
        {
          id: "principal" as const,
          title: "Principal Address / Emergency",
          desc: "Fast, clear, reliable",
          defaults: {
            layout: "single" as LayoutMode,
            publishHls: true,
            recordMp4: true,
            youtube: false,
            viewers: "school" as "school" | "link",
          },
        },
      ] as const,
    []
  );

  const [broadcastId, setBroadcastId] = useState<string | null>(null);
  const [templateId, setTemplateId] = useState<BroadcastTemplateId>("announcements");

  const [org, setOrg] = useState<EduOrgSettings | null>(null);
  const appliedOrgDefaultsRef = useRef(false);

  const eventId = useMemo(() => {
    const sp = new URLSearchParams(loc.search || "");
    const raw = String(sp.get("eventId") || "").trim();
    return raw || null;
  }, [loc.search]);

  const boundEvent = useMemo(() => {
    if (!eventId) return null;
    return getEduEventById(eventId);
  }, [eventId]);

  // Load org defaults/branding for Broadcast (faculty + approved student producers).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const next = await fetchEduOrg();
        if (cancelled) return;
        setOrg(next);
      } catch {
        if (cancelled) return;
        setOrg(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [me.uid]);

  const [publishHls, setPublishHls] = useState(true);
  const [recordMp4, setRecordMp4] = useState(false);

  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [alsoYoutube, setAlsoYoutube] = useState(false);
  const [youtubeDestinationId, setYoutubeDestinationId] = useState<string>("default");

  const [layout, setLayout] = useState<LayoutMode>("speaker");

  const [producer, setProducer] = useState<string>(displayName);
  const [talent, setTalent] = useState<Talent[]>([
    { id: randomId("tal"), name: "Alex M.", micMuted: false, camOff: false },
    { id: randomId("tal"), name: "Jordan K.", micMuted: false, camOff: false },
  ]);
  const [newTalentName, setNewTalentName] = useState<string>("");

  const [viewerAccess, setViewerAccess] = useState<"school" | "link">("school");
  const [lockRoomWhenLive, setLockRoomWhenLive] = useState<boolean>(true);

  const [isLive, setIsLive] = useState(false);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [tick, setTick] = useState(0);

  const [websiteStatus, setWebsiteStatus] = useState<OutputStatus>("off");
  const [recordingStatus, setRecordingStatus] = useState<OutputStatus>("off");
  const [youtubeStatus, setYoutubeStatus] = useState<OutputStatus>("off");

  // If opened via /broadcast?eventId=..., preload settings/crew/title.
  useEffect(() => {
    if (!boundEvent) return;

    // Title/role context: treat as an event-style show.
    setTemplateId("event");
    setLayout(boundEvent.type === "address" ? "single" : boundEvent.type === "assembly" ? "speaker" : "grid");
    setPublishHls(!!boundEvent.outputs.publishHls);
    setRecordMp4(!!boundEvent.outputs.recordMp4);
    setAlsoYoutube(!!boundEvent.outputs.youtube);
    setYoutubeDestinationId(boundEvent.outputs.youtubeDestinationId || "default");

    if (typeof boundEvent.producerName === "string" && boundEvent.producerName.trim()) {
      setProducer(boundEvent.producerName.trim());
    }

    const mappedTalent = (boundEvent.talent || []).map((name) => ({
      id: randomId("tal"),
      name,
      micMuted: false,
      camOff: false,
    }));
    if (mappedTalent.length) setTalent(mappedTalent);
  }, [boundEvent]);

  // Apply org-level defaults once for non-event broadcasts (pre-live only).
  useEffect(() => {
    if (isLive) return;
    if (!org) return;
    if (appliedOrgDefaultsRef.current) return;
    if (eventId && boundEvent) return;
    appliedOrgDefaultsRef.current = true;
    setPublishHls(!!org.defaults?.publishToWebsite);
    setRecordMp4(!!org.defaults?.recordToArchive);
    setLayout(org.defaults?.defaultLayout === "speaker" ? "speaker" : "grid");
  }, [org, isLive, eventId, boundEvent]);

  // Apply template defaults when switching template (pre-live only)
  useEffect(() => {
    if (isLive) return;
    // When opened from Events via ?eventId=..., keep the event's planned settings.
    // Users can still change template manually after load.
    if (eventId && boundEvent) return;
    const t = templates.find((x) => x.id === templateId);
    if (!t) return;
    setLayout(t.defaults.layout);
    setPublishHls(t.defaults.publishHls);
    setRecordMp4(t.defaults.recordMp4);
    setAlsoYoutube(t.defaults.youtube);
    setViewerAccess(t.defaults.viewers);
  }, [templateId, templates, isLive, eventId, boundEvent]);

  // Live timer
  useEffect(() => {
    if (!isLive) return;
    const i = window.setInterval(() => setTick((x) => x + 1), 1000);
    return () => window.clearInterval(i);
  }, [isLive]);

  const elapsed = useMemo(() => {
    if (!isLive || !startedAt) return "0:00";
    return formatElapsed(Date.now() - startedAt);
  }, [isLive, startedAt, tick]);

  // Device check state
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [cameraDevices, setCameraDevices] = useState<MediaDeviceInfo[]>([]);
  const [micDevices, setMicDevices] = useState<MediaDeviceInfo[]>([]);
  const [cameraId, setCameraId] = useState<string>("");
  const [micId, setMicId] = useState<string>("");
  const [deviceError, setDeviceError] = useState<string | null>(null);
  const [micLevel, setMicLevel] = useState<number>(0);
  const liveVideoRef = useRef<HTMLVideoElement | null>(null);
  const streamsRef = useRef<{ cam?: MediaStream; mic?: MediaStream; audioCtx?: AudioContext } | null>(null);

  // LiveKit room + go-live state
  const lkRoomRef = useRef<any>(null);
  const [goLiveData, setGoLiveData] = useState<GoLiveResponse | null>(null);
  const [goLiveError, setGoLiveError] = useState<string | null>(null);
  const [viewerCount, setViewerCount] = useState(0);

  // Pre-recorded media playback state
  const [mediaPlaying, setMediaPlaying] = useState(false);
  const [mediaFileName, setMediaFileName] = useState<string>("");
  const [mediaProgress, setMediaProgress] = useState(0);
  const [mediaDuration, setMediaDuration] = useState(0);
  const mediaVideoRef = useRef<HTMLVideoElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const mediaTracksRef = useRef<any[]>([]);
  const mediaCleanupRef = useRef<(() => void) | null>(null);

  async function refreshDevices() {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    const list = await navigator.mediaDevices.enumerateDevices();
    const cams = list.filter((d) => d.kind === "videoinput");
    const mics = list.filter((d) => d.kind === "audioinput");
    setCameraDevices(cams);
    setMicDevices(mics);
    if (!cameraId && cams[0]?.deviceId) setCameraId(cams[0].deviceId);
    if (!micId && mics[0]?.deviceId) setMicId(mics[0].deviceId);
  }

  useEffect(() => {
    refreshDevices().catch(() => {
      // ignore
    });

    if (!navigator.mediaDevices?.addEventListener) return;
    const handler = () => refreshDevices().catch(() => void 0);
    navigator.mediaDevices.addEventListener("devicechange", handler);
    return () => {
      navigator.mediaDevices.removeEventListener("devicechange", handler);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function stopDeviceStreams() {
    const ref = streamsRef.current;
    if (!ref) return;
    for (const t of ref.cam?.getTracks?.() || []) t.stop();
    for (const t of ref.mic?.getTracks?.() || []) t.stop();
    try {
      await ref.audioCtx?.close?.();
    } catch {
      // ignore
    }
    streamsRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setMicLevel(0);
  }

  useEffect(() => {
    return () => {
      stopDeviceStreams().catch(() => void 0);
    };
  }, []);

  async function testDevices() {
    setDeviceError(null);
    await stopDeviceStreams();
    try {
      const cam = await navigator.mediaDevices.getUserMedia({
        video: cameraId ? { deviceId: { exact: cameraId } } : true,
        audio: false,
      });
      const mic = await navigator.mediaDevices.getUserMedia({
        video: false,
        audio: micId ? { deviceId: { exact: micId } } : true,
      });

      if (videoRef.current) {
        videoRef.current.srcObject = cam;
        await videoRef.current.play().catch(() => void 0);
      }

      // Mic meter
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 512;
      const src = audioCtx.createMediaStreamSource(mic);
      src.connect(analyser);

      const buf = new Uint8Array(analyser.frequencyBinCount);
      let raf = 0;
      const tickMeter = () => {
        analyser.getByteTimeDomainData(buf);
        // Compute RMS (0..1)
        let sum = 0;
        for (let i = 0; i < buf.length; i++) {
          const v = (buf[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / buf.length);
        setMicLevel(Math.min(1, Math.max(0, rms)));
        raf = requestAnimationFrame(tickMeter);
      };
      raf = requestAnimationFrame(tickMeter);

      streamsRef.current = { cam, mic, audioCtx };

      // Stop meter when streams stop
      const cleanup = () => {
        cancelAnimationFrame(raf);
      };
      mic.getTracks().forEach((t) => t.addEventListener("ended", cleanup, { once: true }));
    } catch (e: any) {
      setDeviceError(String(e?.message || "Unable to access camera/mic"));
    }
  }

  async function ensureCameraStream() {
    if (streamsRef.current?.cam) return;
    try {
      const cam = await navigator.mediaDevices.getUserMedia({
        video: cameraId ? { deviceId: { exact: cameraId } } : true,
        audio: false,
      });
      streamsRef.current = { ...(streamsRef.current || {}), cam };
    } catch (e: any) {
      setDeviceError(String(e?.message || "Unable to access camera"));
    }
  }

  useEffect(() => {
    if (!isLive) return;
    const el = liveVideoRef.current;
    if (!el) return;
    const cam = streamsRef.current?.cam;
    if (!cam) return;
    el.srcObject = cam;
    el.muted = true;
    el.playsInline = true;
    el.play().catch(() => void 0);
  }, [isLive]);

  const template = useMemo(() => templates.find((t) => t.id === templateId) || templates[0], [templates, templateId]);

  const orgStudentProducersCanStart = !!org?.defaults?.studentProducersCanStart;
  const orgRequireAssignmentToStart = !!org?.defaults?.requireAssignmentToStart;

  const allowedSummary = useMemo(() => {
    if (isFacultyAdmin) return "Faculty/Admin can start, stop, lock, and moderate";
    if (!orgStudentProducersCanStart) return "Student Producers can configure the show, but cannot start/stop (set in Settings)";
    if (orgRequireAssignmentToStart) return "Student Producers can start/stop when assigned";
    return "Student Producers can start/stop broadcasts";
  }, [isFacultyAdmin, orgStudentProducersCanStart, orgRequireAssignmentToStart]);

  const isAssignedProducer = useMemo(() => {
    if (isFacultyAdmin) return true;
    if (!isStudentProducer) return false;
    if (!orgStudentProducersCanStart) return false;
    if (orgRequireAssignmentToStart) return roleRaw === "student_producer_assigned";
    return true;
  }, [isFacultyAdmin, isStudentProducer, orgStudentProducersCanStart, orgRequireAssignmentToStart, roleRaw]);

  const canStartStop = isFacultyAdmin || (isStudentProducer && isAssignedProducer);
  const canUseYoutube = isFacultyAdmin;
  const canKick = isFacultyAdmin;
  const canMute = isFacultyAdmin || isStudentProducer;
  const canChangeLayout = isFacultyAdmin || isStudentProducer;

  // Demo mode auto-stop timer ref
  const demoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function startBroadcast() {
    if (!canStartStop) return;
    setGoLiveError(null);

    // Show optimistic loading states
    setWebsiteStatus(publishHls ? "starting" : "off");
    setRecordingStatus(recordMp4 ? "starting" : "off");
    setYoutubeStatus(alsoYoutube ? "starting" : "off");

    try {
      // 1) Call go-live API → creates room, starts HLS, returns LiveKit token
      const data = await goLiveEduBroadcast({
        title: boundEvent?.title || template.title,
        templateId,
        layout,
        publishHls,
        recordMp4,
        eventId,
      });
      setGoLiveData(data);
      setBroadcastId(data.broadcast.id);

      // ── Demo bypass: use local camera preview, skip LiveKit ──────
      if (isEduBypassEnabled()) {
        // Reuse the device-check camera stream or grab a fresh one
        await ensureCameraStream();
        const cam = streamsRef.current?.cam;
        if (cam && liveVideoRef.current) {
          liveVideoRef.current.srcObject = cam;
          liveVideoRef.current.muted = true;
          liveVideoRef.current.playsInline = true;
          await liveVideoRef.current.play().catch(() => void 0);
        }

        setIsLive(true);
        setStartedAt(Date.now());
        setWebsiteStatus(publishHls ? "active" : "off");
        setRecordingStatus(recordMp4 ? "active" : "off");
        setYoutubeStatus(alsoYoutube ? "active" : "off");
        setViewerCount(Math.floor(5 + Math.random() * 20));

        if (eventId) setEduEventLive(eventId, true);

        // Auto-stop after 5 minutes in demo mode
        demoTimerRef.current = setTimeout(() => {
          void endBroadcast();
        }, DEMO_MAX_BROADCAST_MS);
        return;
      }

      // 2) Connect to LiveKit room and publish camera/mic
      const { Room, RoomEvent, Track } = await import("livekit-client");
      const room = new Room({ adaptiveStream: true, dynacast: true });
      lkRoomRef.current = room;

      room.on(RoomEvent.ParticipantConnected, () => setViewerCount(room.remoteParticipants.size));
      room.on(RoomEvent.ParticipantDisconnected, () => setViewerCount(room.remoteParticipants.size));

      await room.connect(data.livekitUrl, data.lkToken);

      // Publish local camera + mic
      const camOpts = cameraId ? { deviceId: cameraId } : {};
      const micOpts = micId ? { deviceId: micId } : {};
      await room.localParticipant.setCameraEnabled(true, camOpts);
      await room.localParticipant.setMicrophoneEnabled(true, micOpts);

      // Attach local camera to the live preview
      const camPub = room.localParticipant.getTrackPublication(Track.Source.Camera);
      if (camPub?.track && liveVideoRef.current) {
        camPub.track.attach(liveVideoRef.current);
      }

      // Stop device-check streams since LiveKit owns them now
      void stopDeviceStreams();

      setIsLive(true);
      setStartedAt(Date.now());

      // Update output statuses
      setWebsiteStatus(publishHls ? "active" : "off");
      setRecordingStatus(recordMp4 ? "active" : "off");
      setYoutubeStatus(alsoYoutube ? "active" : "off");

      if (eventId) setEduEventLive(eventId, true);
    } catch (err: any) {
      console.error("[EduBroadcast] go-live error:", err);
      setGoLiveError(err?.message || "Failed to go live");
      setWebsiteStatus(publishHls ? "error" : "off");
      setRecordingStatus(recordMp4 ? "error" : "off");
      setYoutubeStatus("off");
    }
  }

  async function endBroadcast() {
    if (!canStartStop) return;

    // Stop any pre-recorded media playback first
    if (mediaPlaying) { await stopMedia().catch(() => void 0); }

    // Clear demo auto-stop timer
    if (demoTimerRef.current) { clearTimeout(demoTimerRef.current); demoTimerRef.current = null; }

    // Disconnect LiveKit
    if (lkRoomRef.current) {
      try { lkRoomRef.current.disconnect(); } catch {}
      lkRoomRef.current = null;
    }

    // In demo mode, stop local camera streams
    if (isEduBypassEnabled()) {
      void stopDeviceStreams();
    }

    // Stop server-side
    if (broadcastId) {
      try { await stopEduBroadcast(broadcastId); } catch (e: any) {
        console.warn("[EduBroadcast] stop error:", e?.message || e);
      }
    }

    setIsLive(false);
    setStartedAt(null);
    setWebsiteStatus("off");
    setRecordingStatus("off");
    setYoutubeStatus("off");

    if (eventId) setEduEventLive(eventId, false);
  }

  async function emergencyCut() {
    if (!isFacultyAdmin) return;

    // Stop any pre-recorded media playback
    if (mediaCleanupRef.current) { mediaCleanupRef.current(); mediaCleanupRef.current = null; }
    mediaTracksRef.current = [];
    setMediaPlaying(false);

    // Disconnect LiveKit immediately
    if (lkRoomRef.current) {
      try { lkRoomRef.current.disconnect(); } catch {}
      lkRoomRef.current = null;
    }

    // Stop server-side
    if (broadcastId) {
      try { await stopEduBroadcast(broadcastId); } catch (e: any) {
        console.warn("[EduBroadcast] emergency stop error:", e?.message || e);
      }
    }

    setIsLive(false);
    setStartedAt(null);
    setWebsiteStatus(publishHls ? "error" : "off");
    setRecordingStatus(recordMp4 ? "error" : "off");
    setYoutubeStatus(alsoYoutube ? "error" : "off");

    if (eventId) setEduEventLive(eventId, false);

    void (async () => {
      try {
        await postEduAudit({
          action: "broadcast.emergency_cut",
          eventId,
          eventTitle: boundEvent?.title || null,
          targetId: broadcastId,
        });
      } catch {
        // ignore
      }
    })();
  }

  /* ── Pre-recorded media playback helpers ──────────────────────── */

  async function stopMedia() {
    // Unpublish media tracks from LiveKit
    const room = lkRoomRef.current;
    if (room) {
      for (const t of mediaTracksRef.current) {
        try { await room.localParticipant.unpublishTrack(t); } catch {}
      }
    }
    mediaTracksRef.current = [];

    // Pause/stop the hidden video
    if (mediaVideoRef.current) {
      mediaVideoRef.current.pause();
      mediaVideoRef.current.removeAttribute("src");
      mediaVideoRef.current.load();
    }

    // Re-attach camera/mic (only in real LiveKit mode, not demo bypass)
    if (room && !isEduBypassEnabled()) {
      try {
        const { Track } = await import("livekit-client");

        // Re-enable camera
        await room.localParticipant.setCameraEnabled(true);
        const camPub = room.localParticipant.getTrackPublication(Track.Source.Camera);
        if (camPub?.track && liveVideoRef.current) {
          camPub.track.attach(liveVideoRef.current);
        }

        // Re-enable mic
        await room.localParticipant.setMicrophoneEnabled(true);
      } catch (err) {
        console.warn("[EduBroadcast] failed to restore camera/mic after media:", err);
      }
    }

    // Run any additional cleanup (e.g. progress interval)
    if (mediaCleanupRef.current) { mediaCleanupRef.current(); mediaCleanupRef.current = null; }

    setMediaPlaying(false);
    setMediaFileName("");
    setMediaProgress(0);
    setMediaDuration(0);
  }

  async function onFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    // Reset input so re-selecting the same file triggers onChange
    e.target.value = "";

    if (!isLive) return;

    setMediaFileName(file.name);
    setMediaPlaying(true);
    setMediaProgress(0);
    setMediaDuration(0);

    const url = URL.createObjectURL(file);
    const vid = mediaVideoRef.current;
    if (!vid) { URL.revokeObjectURL(url); return; }

    vid.src = url;
    vid.muted = false;
    vid.playsInline = true;

    try {
      await vid.play();
    } catch (err) {
      console.warn("[EduBroadcast] media play error:", err);
      URL.revokeObjectURL(url);
      setMediaPlaying(false);
      return;
    }

    setMediaDuration(vid.duration || 0);

    // Progress timer
    const iv = setInterval(() => {
      if (vid.paused || vid.ended) return;
      setMediaProgress(vid.currentTime || 0);
    }, 500);

    // Auto-stop when media ends
    const handleEnded = () => void stopMedia();
    vid.addEventListener("ended", handleEnded);

    mediaCleanupRef.current = () => {
      clearInterval(iv);
      vid.removeEventListener("ended", handleEnded);
      URL.revokeObjectURL(url);
    };

    // Capture stream from the hidden video element & publish to LiveKit
    const room = lkRoomRef.current;
    if (room && !isEduBypassEnabled()) {
      try {
        const { LocalVideoTrack, LocalAudioTrack } = await import("livekit-client");

        // captureStream is Chrome/Edge; mozCaptureStream for Firefox
        const capture = (vid as any).captureStream?.() || (vid as any).mozCaptureStream?.();
        if (!capture) { console.warn("[EduBroadcast] captureStream not supported"); return; }

        const videoTrack = capture.getVideoTracks()[0];
        const audioTrack = capture.getAudioTracks()[0];

        // Unpublish current camera/mic
        await room.localParticipant.setCameraEnabled(false);
        await room.localParticipant.setMicrophoneEnabled(false);

        const published: any[] = [];
        if (videoTrack) {
          const lkVideo = new LocalVideoTrack(videoTrack);
          await room.localParticipant.publishTrack(lkVideo, { name: "media-video", source: "camera" as any });
          published.push(lkVideo);
        }
        if (audioTrack) {
          const lkAudio = new LocalAudioTrack(audioTrack);
          await room.localParticipant.publishTrack(lkAudio, { name: "media-audio", source: "microphone" as any });
          published.push(lkAudio);
        }
        mediaTracksRef.current = published;

        // Attach capture stream to live preview so the producer sees the media
        if (liveVideoRef.current) {
          liveVideoRef.current.srcObject = capture;
          liveVideoRef.current.muted = true; // avoid double audio
          await liveVideoRef.current.play().catch(() => void 0);
        }
      } catch (err) {
        console.warn("[EduBroadcast] media publish error:", err);
      }
    } else if (isEduBypassEnabled()) {
      // Demo mode: just show the media in the live preview
      if (liveVideoRef.current) {
        liveVideoRef.current.srcObject = null;
        liveVideoRef.current.src = url;
        liveVideoRef.current.muted = false;
        await liveVideoRef.current.play().catch(() => void 0);
      }
    }
  }

  // Poll viewer count while live
  useEffect(() => {
    if (!isLive || !broadcastId) return;
    const interval = setInterval(async () => {
      try {
        const w = await watchEduBroadcast(broadcastId);
        setViewerCount(w.viewerCount);
      } catch {}
    }, 10_000);
    return () => clearInterval(interval);
  }, [isLive, broadcastId]);

  // Cleanup LiveKit on unmount
  useEffect(() => {
    return () => {
      if (lkRoomRef.current) {
        try { lkRoomRef.current.disconnect(); } catch {}
      }
    };
  }, []);

  const plannedActions = useMemo(() => {
    const list: string[] = [];
    if (publishHls) list.push("Will publish to school website");
    if (recordMp4) list.push("Will record to archive");
    if (alsoYoutube) list.push("Will stream to YouTube");
    if (!list.length) list.push("No outputs selected (nothing will be published/recorded)");
    return list;
  }, [publishHls, recordMp4, alsoYoutube]);

  const producersList = useMemo(() => {
    const base = [displayName, "Faculty Admin", "Student Producer A", "Student Producer B"].filter(Boolean);
    return Array.from(new Set(base));
  }, [displayName]);

  if (!isLive) {
    return (
      <div className="space-y-6">
        {boundEvent ? (
          <div className="rounded-2xl border border-slate-800/50 bg-slate-900/50 p-5">
            <div className="text-sm text-slate-400">Event</div>
            <div className="mt-1 text-xl font-bold text-white">{boundEvent.title}</div>
            <div className="mt-1 text-sm text-slate-400">
              {new Date(boundEvent.startsAt).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
            </div>
          </div>
        ) : null}

        {/* Section 1 — Template picker */}
        <div className="rounded-2xl border border-slate-800/50 bg-slate-900/50 p-6">
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-white">Broadcast Type</h2>
            <p className="mt-1 text-sm text-slate-400">Pick a template to load sensible defaults.</p>
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {templates.map((t) => {
              const active = t.id === templateId;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTemplateId(t.id)}
                  className={`rounded-2xl border p-5 text-left transition-colors ${
                    active
                      ? "border-orange-500/40 bg-orange-500/10"
                      : "border-slate-800/50 bg-slate-950/40 hover:border-slate-700 hover:bg-slate-900/40"
                  }`}
                >
                  <div className="text-base font-semibold text-white">{t.title}</div>
                  <div className="mt-1 text-sm text-slate-400">{t.desc}</div>
                  <div className="mt-4 text-xs text-slate-500">Defaults: {t.defaults.layout} layout • {t.defaults.publishHls ? "Publish" : "No publish"} • {t.defaults.recordMp4 ? "Record" : "No record"}</div>
                </button>
              );
            })}
          </div>
          <div className="mt-4 rounded-xl border border-slate-800/50 bg-slate-950/40 p-4 text-sm text-slate-300">
            <div className="font-medium text-white">Selected: {template.title}</div>
            <div className="mt-1 text-slate-400">{allowedSummary}</div>
          </div>
        </div>

        {/* Section 2 — Output controls */}
        <div className="rounded-2xl border border-slate-800/50 bg-slate-900/50 p-6">
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-white">Output Controls</h2>
            <p className="mt-1 text-sm text-slate-400">These are the only things you should need to care about.</p>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Toggle
              checked={publishHls}
              onChange={setPublishHls}
              label="Publish to School Website (HLS)"
              hint="Makes the live program available to viewers"
            />
            <Toggle
              checked={recordMp4}
              onChange={setRecordMp4}
              label="Record to Archive (MP4)"
              hint="Saves a recording automatically"
            />
          </div>

          <div className="mt-4 rounded-xl border border-slate-800/50 bg-slate-950/40 p-4">
            <button
              type="button"
              onClick={() => setAdvancedOpen((v) => !v)}
              className="flex w-full items-center justify-between text-left"
            >
              <div>
                <div className="font-medium text-white">Advanced</div>
                <div className="mt-0.5 text-sm text-slate-400">Optional outputs and destination selection</div>
              </div>
              <div className="text-sm text-slate-400">{advancedOpen ? "Hide" : "Show"}</div>
            </button>

            {advancedOpen ? (
              <div className="mt-4 space-y-3">
                <Toggle
                  checked={alsoYoutube}
                  onChange={setAlsoYoutube}
                  disabled={!canUseYoutube}
                  label="Also stream to YouTube"
                  hint={canUseYoutube ? "Faculty/Admin only • single destination" : "Faculty/Admin only"}
                />

                <div className="rounded-xl border border-slate-800/50 bg-slate-900/30 p-4">
                  <div className="text-sm font-medium text-white">YouTube destination</div>
                  <div className="mt-1 text-sm text-slate-400">Select a pre-saved destination (faculty only).</div>
                  <select
                    disabled={!canUseYoutube || !alsoYoutube}
                    value={youtubeDestinationId}
                    onChange={(e) => setYoutubeDestinationId(e.target.value)}
                    className="mt-3 w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-200"
                  >
                    <option value="default">Default YouTube destination</option>
                  </select>
                </div>
              </div>
            ) : null}
          </div>
        </div>

        {/* Section 3 — Layout picker */}
        <div className="rounded-2xl border border-slate-800/50 bg-slate-900/50 p-6">
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-white">Layout</h2>
            <p className="mt-1 text-sm text-slate-400">Keep it simple.</p>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            {([
              { id: "grid" as const, title: "Grid", desc: "Great for groups" },
              { id: "speaker" as const, title: "Speaker", desc: "Focus on active speaker" },
              { id: "single" as const, title: "Single Speaker", desc: "One camera, one voice" },
            ] as const).map((opt) => {
              const active = layout === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  disabled={!canChangeLayout}
                  onClick={() => setLayout(opt.id)}
                  className={`rounded-2xl border p-5 text-left transition-colors ${
                    active
                      ? "border-orange-500/40 bg-orange-500/10"
                      : "border-slate-800/50 bg-slate-950/40 hover:border-slate-700 hover:bg-slate-900/40"
                  } ${!canChangeLayout ? "opacity-60" : ""}`}
                >
                  <div className="text-base font-semibold text-white">{opt.title}</div>
                  <div className="mt-1 text-sm text-slate-400">{opt.desc}</div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Section 4 — Crew / Access */}
        <div className="rounded-2xl border border-slate-800/50 bg-slate-900/50 p-6">
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-white">Crew / Access</h2>
            <p className="mt-1 text-sm text-slate-400">Assign a producer and manage on-air talent.</p>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="rounded-xl border border-slate-800/50 bg-slate-950/40 p-4">
              <div className="text-sm font-medium text-white">Producer</div>
              <div className="mt-1 text-sm text-slate-400">
                {!orgStudentProducersCanStart
                  ? "Student Producers cannot start/stop (set in Settings)."
                  : orgRequireAssignmentToStart
                    ? "Student Producers can start/stop only when assigned."
                    : "Student Producers can start/stop broadcasts."}
              </div>
              <select
                value={producer}
                onChange={(e) => setProducer(e.target.value)}
                className="mt-3 w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-200"
              >
                {producersList.map((p) => (
                  <option key={p} value={p}>
                    {p === displayName ? "You" : p}
                  </option>
                ))}
              </select>
              {!isFacultyAdmin && isStudentProducer ? (
                <div className="mt-3 text-sm">
                  {isAssignedProducer ? (
                    <span className="text-emerald-300">You can start/stop this broadcast.</span>
                  ) : !orgStudentProducersCanStart ? (
                    <span className="text-amber-300">Start/stop is disabled by policy.</span>
                  ) : (
                    <span className="text-amber-300">You are not assigned — Start Broadcast is disabled.</span>
                  )}
                </div>
              ) : null}
            </div>

            <div className="rounded-xl border border-slate-800/50 bg-slate-950/40 p-4">
              <div className="text-sm font-medium text-white">Viewers</div>
              <div className="mt-1 text-sm text-slate-400">MVP: simple public/private link.</div>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setViewerAccess("link")}
                  className={`rounded-xl border px-4 py-3 text-left transition-colors ${
                    viewerAccess === "link"
                      ? "border-orange-500/40 bg-orange-500/10 text-orange-300"
                      : "border-slate-800/50 bg-slate-900/30 text-slate-300 hover:bg-slate-800/40"
                  }`}
                >
                  <div className="text-sm font-medium">Public</div>
                  <div className="mt-0.5 text-xs text-slate-400">Anyone with link</div>
                </button>
                <button
                  type="button"
                  onClick={() => setViewerAccess("school")}
                  className={`rounded-xl border px-4 py-3 text-left transition-colors ${
                    viewerAccess === "school"
                      ? "border-orange-500/40 bg-orange-500/10 text-orange-300"
                      : "border-slate-800/50 bg-slate-900/30 text-slate-300 hover:bg-slate-800/40"
                  }`}
                >
                  <div className="text-sm font-medium">Private</div>
                  <div className="mt-0.5 text-xs text-slate-400">School only</div>
                </button>
              </div>

              <div className="mt-4">
                <Toggle
                  checked={lockRoomWhenLive}
                  onChange={setLockRoomWhenLive}
                  disabled={!isFacultyAdmin}
                  label="Lock room when live"
                  hint={isFacultyAdmin ? "Prevents unexpected joins while live" : "Faculty/Admin only"}
                />
              </div>
            </div>
          </div>

          <div className="mt-4 rounded-xl border border-slate-800/50 bg-slate-950/40 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-medium text-white">On-Air Talent</div>
                <div className="mt-1 text-sm text-slate-400">Add/remove names for this broadcast.</div>
              </div>
            </div>

            <div className="mt-3 space-y-2">
              {talent.map((p) => (
                <div key={p.id} className="flex items-center justify-between gap-3 rounded-lg bg-slate-900/40 px-3 py-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-white">{p.name}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setTalent((list) => list.filter((x) => x.id !== p.id))}
                    className="rounded-lg border border-slate-700/60 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-900/60"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>

            <div className="mt-3 flex flex-col gap-3 md:flex-row">
              <input
                value={newTalentName}
                onChange={(e) => setNewTalentName(e.target.value)}
                placeholder="Add talent name"
                className="w-full flex-1 rounded-lg border border-slate-700/60 bg-slate-950/40 px-3 py-2 text-sm text-slate-200 outline-none focus:border-orange-500/40"
              />
              <button
                type="button"
                onClick={() => {
                  const name = newTalentName.trim();
                  if (!name) return;
                  setTalent((list) => [...list, { id: randomId("tal"), name, micMuted: false, camOff: false }]);
                  setNewTalentName("");
                }}
                className="rounded-lg bg-gradient-to-r from-orange-500 via-red-600 to-violet-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-transform hover:-translate-y-0.5 hover:from-orange-400 hover:via-red-500 hover:to-violet-500"
              >
                Add
              </button>
            </div>
          </div>
        </div>

        {/* Section 5 — Device check */}
        <div className="rounded-2xl border border-slate-700 bg-gradient-to-br from-slate-800 to-slate-800/50 p-6">
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-white">Device Check</h2>
            <p className="mt-1 text-sm text-slate-400">Confirm camera/mic permissions before going live.</p>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="rounded-xl border border-slate-800/50 bg-slate-950/40 p-4">
              <div className="text-sm font-medium text-white">Camera</div>
              <select
                value={cameraId}
                onChange={(e) => setCameraId(e.target.value)}
                  className="mt-3 w-full rounded-lg border border-slate-700/60 bg-slate-950/40 px-3 py-2 text-sm text-slate-200 outline-none focus:border-orange-500/40"
              >
                {cameraDevices.length ? (
                  cameraDevices.map((d) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label || "Camera"}
                    </option>
                  ))
                ) : (
                  <option value="">No cameras detected</option>
                )}
              </select>
              <div className="mt-3">
                <button
                  type="button"
                  onClick={() => testDevices()}
                  className="rounded-lg border border-slate-800 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800"
                >
                  Test Devices
                </button>
                <button
                  type="button"
                  onClick={() => {
                    stopDeviceStreams().catch(() => void 0);
                    refreshDevices().catch(() => void 0);
                  }}
                  className="ml-3 rounded-lg border border-slate-800 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800"
                >
                  Refresh
                </button>
              </div>
              {deviceError ? <div className="mt-3 text-sm text-red-300">{deviceError}</div> : null}
            </div>

            <div className="rounded-xl border border-slate-800/50 bg-slate-950/40 p-4">
              <div className="text-sm font-medium text-white">Mic</div>
              <select
                value={micId}
                onChange={(e) => setMicId(e.target.value)}
                className="mt-3 w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-200"
              >
                {micDevices.length ? (
                  micDevices.map((d) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label || "Microphone"}
                    </option>
                  ))
                ) : (
                  <option value="">No microphones detected</option>
                )}
              </select>
              <div className="mt-4">
                <div className="mb-1 flex items-center justify-between text-xs text-slate-400">
                  <span>Level</span>
                  <span>{Math.round(micLevel * 100)}%</span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800">
                  <div className="h-full bg-emerald-500" style={{ width: `${Math.min(100, Math.round(micLevel * 100))}%` }} />
                </div>
                <div className="mt-3 text-xs text-slate-500">If you can’t see devices, allow permissions in your browser settings.</div>
              </div>
            </div>
          </div>

          <div className="mt-4 overflow-hidden rounded-xl border border-slate-800/50 bg-slate-950/40">
            <div className="flex items-center justify-between border-b border-slate-800/50 px-4 py-3">
              <div className="text-sm font-medium text-white">Preview</div>
              <button
                type="button"
                onClick={() => stopDeviceStreams().catch(() => void 0)}
                className="rounded-lg border border-slate-800 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800"
              >
                Stop
              </button>
            </div>
            <div className="p-4">
              <video ref={videoRef} playsInline muted className="aspect-video w-full rounded-lg bg-black" />
            </div>
          </div>
        </div>

        {/* Primary CTA */}
        <div className="rounded-2xl border border-slate-700 bg-gradient-to-br from-slate-800 to-slate-800/50 p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="text-lg font-semibold text-white">Ready?</div>
              <div className="mt-1 text-sm text-slate-400">Starts the live program and publishes to website if enabled.</div>
            </div>
            <button
              type="button"
              disabled={!canStartStop}
              onClick={startBroadcast}
              className={`rounded-2xl px-6 py-4 text-base font-bold text-white transition-colors ${
                canStartStop
                  ? "bg-gradient-to-r from-orange-500 via-red-600 to-violet-600 hover:from-orange-400 hover:via-red-500 hover:to-violet-500"
                  : "cursor-not-allowed bg-slate-700"
              }`}
            >
              Start Broadcast
            </button>
          </div>

          <div className="mt-4 rounded-xl border border-slate-700/60 bg-slate-950/40 p-4">
            <div className="text-sm font-medium text-white">What will happen</div>
            <ul className="mt-2 space-y-1 text-sm text-slate-300">
              {plannedActions.map((t) => (
                <li key={t}>• {t}</li>
              ))}
            </ul>
          </div>

          {goLiveError ? (
            <div className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">
              <span className="font-semibold">Go-live failed:</span> {goLiveError}
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  // Live control room
  return (
    <div className="space-y-6">
      {/* Top bar */}
      <div className="sticky top-16 z-30 rounded-2xl border border-slate-700 bg-slate-900/70 p-4 backdrop-blur-xl">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 rounded-full bg-red-500/15 px-3 py-1 text-sm font-semibold text-red-300">
              <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" />
              LIVE
            </div>
            <div className="text-sm text-slate-300">Elapsed: {elapsed}</div>
            {viewerCount > 0 ? <div className="text-xs text-slate-400">{viewerCount} viewer{viewerCount !== 1 ? "s" : ""}</div> : null}
            {broadcastId ? <div className="text-xs text-slate-500">ID: {broadcastId}</div> : null}
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Toggle
              checked={lockRoomWhenLive}
              onChange={setLockRoomWhenLive}
              disabled={!isFacultyAdmin}
              label="Lock room"
              hint={!isFacultyAdmin ? "Faculty/Admin only" : undefined}
            />
            <button
              type="button"
              disabled={!canStartStop}
              onClick={endBroadcast}
              className={`rounded-xl px-4 py-3 text-sm font-semibold text-white ${
                canStartStop ? "bg-red-600 hover:bg-red-500" : "cursor-not-allowed bg-slate-700"
              }`}
            >
              End Broadcast
            </button>
            <button
              type="button"
              disabled={!isFacultyAdmin}
              onClick={emergencyCut}
              className={`rounded-xl border px-4 py-3 text-sm font-semibold ${
                isFacultyAdmin
                  ? "border-red-500/40 bg-red-500/10 text-red-200 hover:bg-red-500/15"
                  : "cursor-not-allowed border-slate-800/50 bg-slate-900/20 text-slate-500"
              }`}
            >
              Emergency Cut
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Left — Program preview */}
        <div className="lg:col-span-2 space-y-4">
          <div className="rounded-2xl border border-slate-800/50 bg-slate-900/50 p-6">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <div className="text-lg font-semibold text-white">Program Preview</div>
                <div className="mt-1 text-sm text-slate-400">What website viewers see</div>
              </div>
              <div className="rounded-full border border-slate-800/50 bg-slate-950/40 px-3 py-1 text-xs text-slate-300">
                Layout: <span className="font-semibold text-white">{layout}</span>
              </div>
            </div>

            <div className="relative aspect-video w-full overflow-hidden rounded-xl border border-slate-800/50 bg-black">
              <video ref={liveVideoRef} className="h-full w-full object-cover" />
              {!streamsRef.current?.cam && !mediaPlaying ? (
                <div className="absolute inset-0 flex items-center justify-center p-6 text-center">
                  <div className="rounded-xl border border-slate-800/50 bg-slate-950/70 px-4 py-3 text-sm text-slate-200">
                    No camera preview yet. Use Device Check before starting, or allow camera permissions.
                  </div>
                </div>
              ) : null}
              {/* Media progress overlay */}
              {mediaPlaying && (
                <div className="absolute bottom-0 left-0 right-0 bg-black/60 px-3 py-2 flex items-center gap-3">
                  <span className="text-xs font-medium text-orange-300 truncate max-w-[200px]">{mediaFileName}</span>
                  <div className="flex-1 h-1.5 rounded-full bg-slate-700 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-orange-500 to-red-500 transition-all"
                      style={{ width: mediaDuration > 0 ? `${Math.min((mediaProgress / mediaDuration) * 100, 100)}%` : "0%" }}
                    />
                  </div>
                  <span className="text-xs text-slate-300 font-mono whitespace-nowrap">
                    {formatElapsed(Math.floor(mediaProgress) * 1000)}/{formatElapsed(Math.floor(mediaDuration) * 1000)}
                  </span>
                </div>
              )}
            </div>

            <div className="mt-4">
              <div className="text-sm font-medium text-white">Switch layout</div>
              <div className="mt-2 grid grid-cols-1 gap-3 md:grid-cols-3">
                {([
                  { id: "grid" as const, title: "Grid" },
                  { id: "speaker" as const, title: "Speaker" },
                  { id: "single" as const, title: "Single" },
                ] as const).map((opt) => {
                  const active = layout === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      disabled={!canChangeLayout}
                      onClick={() => setLayout(opt.id)}
                      className={`rounded-xl border px-4 py-3 text-left text-sm transition-colors ${
                        active
                          ? "border-orange-500/40 bg-orange-500/10 text-orange-300"
                          : "border-slate-800/50 bg-slate-950/40 text-slate-200 hover:bg-slate-900/40"
                      } ${!canChangeLayout ? "opacity-60" : ""}`}
                    >
                      {opt.title}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Pre-recorded media playback controls */}
          <div className="rounded-2xl border border-slate-800/50 bg-slate-900/50 p-6">
            <div className="mb-4">
              <div className="text-lg font-semibold text-white">Pre-recorded Media</div>
              <div className="mt-1 text-sm text-slate-400">Play a video/audio file through the broadcast feed.</div>
            </div>
            <div className="flex items-center gap-3">
              {!mediaPlaying ? (
                <button
                  type="button"
                  disabled={!canStartStop}
                  onClick={() => fileInputRef.current?.click()}
                  className={`rounded-xl px-4 py-3 text-sm font-semibold transition-colors ${
                    canStartStop
                      ? "bg-gradient-to-r from-orange-500 via-red-600 to-violet-600 text-white hover:from-orange-400 hover:via-red-500 hover:to-violet-500"
                      : "cursor-not-allowed bg-slate-700 text-slate-400"
                  }`}
                >
                  Play Media
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void stopMedia()}
                  className="rounded-xl bg-red-600 px-4 py-3 text-sm font-semibold text-white hover:bg-red-500"
                >
                  Stop Media
                </button>
              )}
              {mediaPlaying && (
                <span className="text-sm text-slate-300 truncate max-w-[250px]">{mediaFileName}</span>
              )}
            </div>
          </div>

          {/* Outputs status */}
          <div className="rounded-2xl border border-slate-800/50 bg-slate-900/50 p-6">
            <div className="mb-4">
              <div className="text-lg font-semibold text-white">Outputs</div>
              <div className="mt-1 text-sm text-slate-400">Clear status for each output.</div>
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <StatusChip label="Website" status={publishHls ? websiteStatus : "off"} />
              <StatusChip label="Recording" status={recordMp4 ? recordingStatus : "off"} />
              {alsoYoutube ? <StatusChip label="YouTube" status={youtubeStatus} /> : <StatusChip label="YouTube" status="off" />}
            </div>
          </div>
        </div>

        {/* Right — Participants / crew */}
        <div className="space-y-4">
          <div className="rounded-2xl border border-slate-800/50 bg-slate-900/50 p-6">
            <div className="mb-4">
              <div className="text-lg font-semibold text-white">Participants</div>
              <div className="mt-1 text-sm text-slate-400">On-air talent and crew controls.</div>
            </div>

            <div className="space-y-2">
              {talent.map((p) => (
                <div key={p.id} className="rounded-xl border border-slate-800/50 bg-slate-950/40 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate font-medium text-white">{p.name}</div>
                      <div className="mt-1 text-xs text-slate-500">On-air</div>
                    </div>
                    {canKick ? (
                      <button
                        type="button"
                        onClick={() => setTalent((list) => list.filter((x) => x.id !== p.id))}
                        className="rounded-lg border border-slate-800 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800"
                      >
                        Remove
                      </button>
                    ) : null}
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      disabled={!canMute}
                      onClick={() =>
                        setTalent((list) =>
                          list.map((x) => (x.id === p.id ? { ...x, micMuted: !x.micMuted } : x))
                        )
                      }
                      className={`rounded-lg border px-3 py-2 text-xs transition-colors ${
                        p.micMuted
                          ? "border-amber-500/30 bg-amber-500/10 text-amber-200"
                          : "border-slate-800 bg-slate-950/40 text-slate-200 hover:bg-slate-900/40"
                      } ${!canMute ? "cursor-not-allowed opacity-60" : ""}`}
                    >
                      {p.micMuted ? "Mic muted" : "Mute mic"}
                    </button>
                    <button
                      type="button"
                      disabled={!canMute}
                      onClick={() =>
                        setTalent((list) =>
                          list.map((x) => (x.id === p.id ? { ...x, camOff: !x.camOff } : x))
                        )
                      }
                      className={`rounded-lg border px-3 py-2 text-xs transition-colors ${
                        p.camOff
                          ? "border-amber-500/30 bg-amber-500/10 text-amber-200"
                          : "border-slate-800 bg-slate-950/40 text-slate-200 hover:bg-slate-900/40"
                      } ${!canMute ? "cursor-not-allowed opacity-60" : ""}`}
                    >
                      {p.camOff ? "Cam off" : "Turn off cam"}
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-4 rounded-xl border border-slate-800/50 bg-slate-950/40 p-4">
              <div className="text-sm font-medium text-white">Add talent</div>
              <div className="mt-1 text-sm text-slate-400">MVP: manage the on-air roster here.</div>
              <div className="mt-3 flex flex-col gap-3">
                <input
                  value={newTalentName}
                  onChange={(e) => setNewTalentName(e.target.value)}
                  placeholder="Talent name"
                  className="w-full rounded-lg border border-slate-700/60 bg-slate-950/40 px-3 py-2 text-sm text-slate-200 outline-none focus:border-orange-500/40"
                />
                <button
                  type="button"
                  onClick={() => {
                    const name = newTalentName.trim();
                    if (!name) return;
                    setTalent((list) => [...list, { id: randomId("tal"), name, micMuted: false, camOff: false }]);
                    setNewTalentName("");
                  }}
                  className="rounded-lg bg-gradient-to-r from-orange-500 via-red-600 to-violet-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-transform hover:-translate-y-0.5 hover:from-orange-400 hover:via-red-500 hover:to-violet-500"
                >
                  Add talent
                </button>
              </div>
              <div className="mt-3 text-xs text-slate-500">Talent should join via a separate Studio link/page (Phase 2).</div>
            </div>
          </div>

          {/* Branding */}
          <div className="flex items-center justify-center rounded-2xl border border-slate-700 bg-gradient-to-br from-slate-800 to-slate-800/50 p-6">
            <img src="/edu_logo.png" alt="StreamLine EDU" className="h-14 w-auto opacity-80" />
          </div>
        </div>
      </div>

      {/* Hidden elements for media playback */}
      <video ref={mediaVideoRef} className="hidden" playsInline />
      <input
        ref={fileInputRef}
        type="file"
        accept="video/*,audio/*"
        className="hidden"
        onChange={onFileSelected}
      />
    </div>
  );
}
