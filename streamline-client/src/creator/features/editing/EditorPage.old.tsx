import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { 
  Play, 
  Pause, 
  ZoomIn, 
  ZoomOut, 
  Trash2, 
  Download,
  Settings,
  ChevronLeft,
  Clock,
  Volume2,
  VolumeX,
  Lock,
  Unlock,
  Link2,
  Undo2,
  Redo2,
  Upload,
} from "lucide-react";
import { editingApi, type Recording, type TimelineClipRecord, type ProjectAssetRecord, type SavedVideo } from "../../../lib/editingApi";
import { apiFetchAuth } from "../../../lib/api";
import { API_BASE } from "../../../lib/apiBase";
import { useEditingFeatures } from "./useEditingFeatures";
import {
  listProjectAssets,
  getAssetDownloadUrl,
  uploadAssetToProject,
} from "../../../lib/projectsApi";
import type { ProjectAsset } from "../../../lib/projectsApi";

// ============================================================================
// TYPES
// ============================================================================

type Track = {
  id: string;
  name: string;
  type: 'video' | 'audio';
  muted: boolean;
  locked: boolean;
  solo: boolean;
  linkedTrackId: string | null; // null = unlinked, else = paired track id
};

type TimelineClip = {
  id: string;
  assetId: string;
  trackId: string; // which track this clip belongs to
  startTime: number;
  duration: number;
  inPoint: number;
  outPoint: number;
  name: string;
  videoUrl: string;
};

// ============================================================================
// CONSTANTS
// ============================================================================

const SAMPLE_VIDEO_URL =
  "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4";

const PIXELS_PER_SECOND = 12;
const TIMELINE_LEFT_GUTTER_PX = 80;

// ============================================================================
// UNDO / REDO TYPES
// ============================================================================

type HistorySnapshot = {
  clips: TimelineClip[];
  tracks: Track[];
};

const MAX_UNDO_HISTORY = 50;

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function EditorPage() {
  const nav = useNavigate();
  const { projectId } = useParams<{ projectId: string }>();
  const [searchParams] = useSearchParams();
  const { features, getFeatureValue } = useEditingFeatures();

  // Project state
  const [projectName, setProjectName] = useState("Untitled Project");
  const [tracks, setTracks] = useState<Track[]>([
    { id: 'video_1', name: 'Video 1', type: 'video', muted: false, locked: false, solo: false, linkedTrackId: 'audio_1' },
    { id: 'audio_1', name: 'Audio 1', type: 'audio', muted: false, locked: false, solo: false, linkedTrackId: 'video_1' },
  ]);
  const [clips, setClips] = useState<TimelineClip[]>([]);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  // Playback state
  const [playheadTime, setPlayheadTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  // UI state
  const [zoom, setZoom] = useState(1);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [exportResolution, setExportResolution] = useState("720p");
  const [exportFormat, setExportFormat] = useState("mp4");
  const [uploading, setUploading] = useState(false);
  const [showAddAssetMenu, setShowAddAssetMenu] = useState(false);
  const [showSavedVideosPicker, setShowSavedVideosPicker] = useState(false);
  const [savedRecordings, setSavedRecordings] = useState<Recording[]>([]);
  const [loadingSaved, setLoadingSaved] = useState(false);
  const fileInputRef2 = useRef<HTMLInputElement>(null);

  // Undo/redo state
  const undoStack = useRef<HistorySnapshot[]>([]);
  const redoStack = useRef<HistorySnapshot[]>([]);

  // Drag state for trim handles and clip reorder
  const [dragState, setDragState] = useState<{
    type: 'trim-left' | 'trim-right' | 'move';
    clipId: string;
    startX: number;
    originalClip: TimelineClip;
  } | null>(null);

  // Refs
  const videoRef = useRef<HTMLVideoElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const playAnimationRef = useRef<number | null>(null);

  // ============================================================================
  // UNDO / REDO HELPERS
  // ============================================================================

  const pushUndoSnapshot = useCallback(() => {
    undoStack.current = [
      ...undoStack.current.slice(-(MAX_UNDO_HISTORY - 1)),
      { clips: structuredClone(clips), tracks: structuredClone(tracks) },
    ];
    redoStack.current = [];
  }, [clips, tracks]);

  const handleUndo = useCallback(() => {
    if (undoStack.current.length === 0) return;
    const prev = undoStack.current[undoStack.current.length - 1];
    undoStack.current = undoStack.current.slice(0, -1);
    redoStack.current = [
      ...redoStack.current,
      { clips: structuredClone(clips), tracks: structuredClone(tracks) },
    ];
    setClips(prev.clips);
    setTracks(prev.tracks);
  }, [clips, tracks]);

  const handleRedo = useCallback(() => {
    if (redoStack.current.length === 0) return;
    const next = redoStack.current[redoStack.current.length - 1];
    redoStack.current = redoStack.current.slice(0, -1);
    undoStack.current = [
      ...undoStack.current,
      { clips: structuredClone(clips), tracks: structuredClone(tracks) },
    ];
    setClips(next.clips);
    setTracks(next.tracks);
  }, [clips, tracks]);

  // ============================================================================
  // COMPUTED VALUES
  // ============================================================================

  const totalDuration = clips.reduce((sum, c) => Math.max(sum, c.startTime + c.duration), 0);
  const timelineWidth = Math.max(800, totalDuration * PIXELS_PER_SECOND * zoom);
  const selectedClip = clips.find((c) => c.id === selectedClipId);

  // Video tracks first, then audio tracks for timeline layout
  const sortedTracks = useMemo(() => {
    const video = tracks.filter(t => t.type === 'video');
    const audio = tracks.filter(t => t.type === 'audio');
    return [...video, ...audio];
  }, [tracks]);

  // ============================================================================
  // LOAD PROJECT DATA
  // ============================================================================

  useEffect(() => {
    let cancelled = false;

    const loadProject = async () => {
      if (projectId === "new") {
        const recordingId = searchParams.get("recordingId");
        const assetId = searchParams.get("assetId");

        if (recordingId) {
          console.log('📹 Loading recording:', recordingId);

          // Try the typed API first, fall back to raw fetch
          let recording: any = null;
          try {
            recording = await editingApi.getRecording(recordingId);
          } catch {
            // editingApi may throw – try direct fetch as backup
          }

          if (!recording) {
            try {
              const res = await apiFetchAuth(`/api/editing/recordings/${recordingId}`, {}, { allowNonOk: true });
              if (res.ok) recording = await res.json();
            } catch {
              // network error – handled below
            }
          }

          if (cancelled) return;
          console.log('✅ Recording loaded:', recording);

          if (recording) {
            setProjectName(`Edit: ${recording.title}`);
            const videoUrl = recording.videoUrl || SAMPLE_VIDEO_URL;
            const duration = Math.min(recording.duration || 60, 600);

            // Create linked video + audio clips
            setTracks([
              { id: 'video_1', name: 'Video 1', type: 'video', muted: false, locked: false, solo: false, linkedTrackId: 'audio_1' },
              { id: 'audio_1', name: 'Audio 1', type: 'audio', muted: false, locked: false, solo: false, linkedTrackId: 'video_1' },
            ]);
            setClips([
              {
                id: `clip_v_${Date.now()}`,
                assetId: recordingId,
                trackId: 'video_1',
                startTime: 0,
                duration,
                inPoint: 0,
                outPoint: duration,
                name: recording.title || 'Video',
                videoUrl,
              },
              {
                id: `clip_a_${Date.now()}`,
                assetId: recordingId,
                trackId: 'audio_1',
                startTime: 0,
                duration,
                inPoint: 0,
                outPoint: duration,
                name: recording.title || 'Audio',
                videoUrl,
              },
            ]);
            
            setTimeout(() => {
              if (!cancelled && videoRef.current) {
                videoRef.current.src = videoUrl;
                videoRef.current.load();
              }
            }, 100);
          } else {
            console.error('❌ Recording not found or has no videoUrl:', recordingId);
            setProjectName("New Project");
          }
        } else if (assetId) {
          const asset = await editingApi.getAsset(assetId);
          if (cancelled) return;
          if (asset) {
            const videoUrl = asset.videoUrl || SAMPLE_VIDEO_URL;
            const duration = asset.duration || 60;

            setProjectName(`Project: ${asset.name}`);

            const now = Date.now();
            setClips([
              {
                id: `clip_video_${now}`,
                assetId,
                trackId: 'video_1',
                startTime: 0,
                duration,
                inPoint: 0,
                outPoint: duration,
                name: asset.name,
                videoUrl,
              },
              {
                id: `clip_audio_${now}`,
                assetId,
                trackId: 'audio_1',
                startTime: 0,
                duration,
                inPoint: 0,
                outPoint: duration,
                name: asset.name,
                videoUrl,
              },
            ]);

            setTimeout(() => {
              if (!cancelled && videoRef.current) {
                videoRef.current.src = videoUrl;
                videoRef.current.load();
              }
            }, 100);
          }
        } else {
          // No asset specified — start with empty timeline
          setProjectName("Untitled Project");
          setClips([]);
        }
      } else {
        // Load existing project
        console.log('[editor] Loading existing project:', projectId);
        let proj: any = null;
        try {
          proj = await editingApi.getProject(projectId!);
        } catch (e) {
          console.error('[editor] editingApi.getProject failed:', e);
        }
        if (cancelled) return;
        console.log('[editor] Project loaded:', proj ? { id: proj.id, name: proj.name, timeline: proj.timeline } : null);

        if (proj) {
          setProjectName(proj.name);

          // ────────────────────────────────────────────────────────────────────
          // NEW 3-LAYER ARCHITECTURE: Try to load timeline clips from the
          // /api/projects/:id endpoint that returns { project, projectAssets,
          // timelineClips, savedVideos }
          // ────────────────────────────────────────────────────────────────────
          let layeredData: {
            projectAssets?: ProjectAssetRecord[];
            timelineClips?: TimelineClipRecord[];
            savedVideos?: Record<string, Partial<SavedVideo>>;
          } | null = null;

          try {
            const layeredRes = await apiFetchAuth(
              `${API_BASE}/api/projects/${projectId}`,
              {},
              { allowNonOk: true },
            );
            if (layeredRes.ok) {
              layeredData = await layeredRes.json();
            }
          } catch (e) {
            console.warn('[editor] 3-layer project fetch failed (non-fatal):', e);
          }
          if (cancelled) return;

          const layeredClips = layeredData?.timelineClips ?? [];
          const layeredAssets = layeredData?.projectAssets ?? [];
          const savedVideos = layeredData?.savedVideos ?? {};

          if (layeredClips.length > 0) {
            console.log('[editor] 3-layer timeline clips found:', layeredClips.length);

            // Build a URL map: projectAssetId → playbackUrl
            const assetUrlMap = new Map<string, string>();
            const assetTitleMap = new Map<string, string>();
            for (const pa of layeredAssets) {
              const sv = savedVideos[pa.savedVideoId];
              if (sv?.playbackUrl) {
                assetUrlMap.set(pa.id, sv.playbackUrl);
                assetTitleMap.set(pa.id, sv.title || 'Clip');
              }
            }

            // Convert TimelineClipRecords to local TimelineClip format
            const restoredClips: TimelineClip[] = layeredClips.map((tc) => ({
              id: tc.id,
              assetId: tc.projectAssetId,
              trackId: tc.trackId,
              startTime: tc.startMs / 1000,
              duration: (tc.endMs - tc.startMs) / 1000,
              inPoint: tc.trimInMs / 1000,
              outPoint: tc.trimOutMs / 1000,
              name: assetTitleMap.get(tc.projectAssetId) || (tc.kind === 'audio' ? 'Audio' : 'Video'),
              videoUrl: assetUrlMap.get(tc.projectAssetId) || SAMPLE_VIDEO_URL,
            }));

            // Ensure we have tracks for all referenced trackIds
            const usedTrackIds = new Set(restoredClips.map((c) => c.trackId));
            const newTracks: Track[] = [];
            if (usedTrackIds.has('video_1')) {
              newTracks.push({ id: 'video_1', name: 'Video 1', type: 'video', muted: false, locked: false, solo: false, linkedTrackId: 'audio_1' });
            }
            if (usedTrackIds.has('audio_1')) {
              newTracks.push({ id: 'audio_1', name: 'Audio 1', type: 'audio', muted: false, locked: false, solo: false, linkedTrackId: 'video_1' });
            }
            if (newTracks.length > 0) {
              setTracks(newTracks);
            }

            setClips(restoredClips);

            // Set video player source
            setTimeout(() => {
              const firstVideoUrl = restoredClips.find((c) => c.trackId.startsWith('video'))?.videoUrl;
              if (!cancelled && videoRef.current && firstVideoUrl) {
                videoRef.current.src = firstVideoUrl;
                videoRef.current.load();
              }
            }, 50);

            return; // Done — skip legacy loading paths
          }

          // ────────────────────────────────────────────────────────────────────
          // LEGACY PATH: Fallback to existing project asset + timeline loading
          // ────────────────────────────────────────────────────────────────────

          // Fetch real project assets for fresh signed download URLs
          let projectAssets: ProjectAsset[] = [];
          try {
            projectAssets = await listProjectAssets(projectId!);
          } catch (e) {
            console.warn("[editor] Failed to load project assets:", e);
          }
          if (cancelled) return;
          console.log('[editor] Project assets:', projectAssets.length, projectAssets.map(a => ({ id: a.id, type: a.type, status: a.processingStatus, storageKey: a.storageKey, sourceRecordingId: a.sourceRecordingId })));

          const readyAssets = projectAssets.filter(
            a => a.processingStatus === 'ready' && (a.type === 'recording' || a.type === 'upload')
          );
          console.log('[editor] Ready assets:', readyAssets.length);

          // Build download URL map (projectAssetId → url, sourceRecordingId → url)
          const urlMap = new Map<string, string>();
          await Promise.all(readyAssets.map(async (asset) => {
            try {
              const result = await getAssetDownloadUrl(projectId!, asset.id);
              urlMap.set(asset.id, result.downloadUrl);
              if (asset.sourceRecordingId) {
                urlMap.set(asset.sourceRecordingId, result.downloadUrl);
              }
            } catch (e) {
              console.warn(`[editor] Failed to get download URL for asset ${asset.id}:`, e);
            }
          }));
          if (cancelled) return;
          console.log('[editor] URL map keys:', Array.from(urlMap.keys()));

          // Check for saved timeline state
          const savedTracks = (proj as any)?.timeline?.tracks;
          const savedClips = (proj as any)?.timeline?.clips;
          console.log('[editor] Saved timeline — tracks:', savedTracks, 'clips:', savedClips);

          if (Array.isArray(savedClips) && savedClips.length > 0) {
            // Restore saved track layout
            if (Array.isArray(savedTracks) && savedTracks.length > 0) {
              setTracks(savedTracks.map((t: any, idx: number) => ({
                id: String(t?.id || `track_${idx}`),
                name: String(t?.name || 'Track'),
                type: t?.type === 'audio' ? 'audio' as const : 'video' as const,
                muted: !!t?.muted,
                locked: !!t?.locked,
                solo: !!t?.solo,
                linkedTrackId: typeof t?.linkedTrackId === 'string' ? t.linkedTrackId : null,
              })));
            }

            // Restore clips with refreshed download URLs
            const normalized = savedClips.map((c: any) => ({
              id: String(c?.id || `clip_${Date.now()}`),
              assetId: String(c?.assetId || ''),
              trackId: typeof c?.trackId === 'string' ? c.trackId : 'video_1',
              startTime: Number(c?.startTime || 0),
              duration: Number(c?.duration || 0),
              inPoint: Number(c?.inPoint || 0),
              outPoint: Number(c?.outPoint || 0),
              name: String(c?.name || proj.name),
              videoUrl: urlMap.get(String(c?.assetId || '')) || String(c?.videoUrl || SAMPLE_VIDEO_URL),
            }));
            console.log('[editor] Restored clips:', normalized.length, normalized.map(c => ({ id: c.id, videoUrl: c.videoUrl?.slice(0, 80) })));

            // If all clips have empty/missing videoUrls (bridge stubs), auto-populate from assets instead
            const hasRealUrls = normalized.some(c => c.videoUrl && c.videoUrl !== SAMPLE_VIDEO_URL && c.videoUrl !== '');
            if (!hasRealUrls && readyAssets.length > 0) {
              console.log('[editor] Saved clips have no real URLs — falling through to auto-populate');
            } else {
              setClips(normalized);
              setTimeout(() => {
                const firstUrl = normalized[0]?.videoUrl;
                if (!cancelled && videoRef.current && firstUrl) {
                  videoRef.current.src = firstUrl;
                  videoRef.current.load();
                }
              }, 50);
              return; // done — skip auto-populate
            }
          }

          if (readyAssets.length > 0) {
            // No saved timeline — auto-populate from project assets
            // All video clips on video_1, all audio clips on audio_1, linked
            setTracks([
              { id: 'video_1', name: 'Video 1', type: 'video', muted: false, locked: false, solo: false, linkedTrackId: 'audio_1' },
              { id: 'audio_1', name: 'Audio 1', type: 'audio', muted: false, locked: false, solo: false, linkedTrackId: 'video_1' },
            ]);

            let currentTime = 0;
            const newClips: TimelineClip[] = [];
            for (const asset of readyAssets) {
              const duration = asset.duration || 60;
              const downloadUrl = urlMap.get(asset.id) || '';

              newClips.push({
                id: `clip_v_${asset.id}`,
                assetId: asset.id,
                trackId: 'video_1',
                startTime: currentTime,
                duration,
                inPoint: 0,
                outPoint: duration,
                name: asset.filename || 'Video',
                videoUrl: downloadUrl,
              });
              newClips.push({
                id: `clip_a_${asset.id}`,
                assetId: asset.id,
                trackId: 'audio_1',
                startTime: currentTime,
                duration,
                inPoint: 0,
                outPoint: duration,
                name: asset.filename || 'Audio',
                videoUrl: downloadUrl,
              });
              currentTime += duration;
            }
            setClips(newClips);

            setTimeout(() => {
              const firstUrl = newClips[0]?.videoUrl;
              if (!cancelled && videoRef.current && firstUrl) {
                videoRef.current.src = firstUrl;
                videoRef.current.load();
              }
            }, 50);
          }

          // Last-resort fallback: if no assets/clips were loaded but the project bridge has an assetId (recording ID),
          // try to load the recording directly
          if (readyAssets.length === 0) {
            const bridgeAssetId = (proj as any)?.assetId;
            console.log('[editor] No ready assets found. Bridge assetId:', bridgeAssetId);
            if (bridgeAssetId) {
              let recording: any = null;
              try {
                recording = await editingApi.getRecording(bridgeAssetId);
              } catch { /* non-fatal */ }
              if (!recording) {
                try {
                  const res = await apiFetchAuth(`/api/editing/recordings/${bridgeAssetId}`, {}, { allowNonOk: true });
                  if (res.ok) recording = await res.json();
                } catch { /* non-fatal */ }
              }
              if (cancelled) return;
              console.log('[editor] Fallback recording:', recording ? { title: recording.title, videoUrl: recording.videoUrl?.slice(0, 80) } : null);
              if (recording?.videoUrl) {
                const videoUrl = recording.videoUrl;
                const duration = Math.min(recording.duration || 60, 600);
                setTracks([
                  { id: 'video_1', name: 'Video 1', type: 'video', muted: false, locked: false, solo: false, linkedTrackId: 'audio_1' },
                  { id: 'audio_1', name: 'Audio 1', type: 'audio', muted: false, locked: false, solo: false, linkedTrackId: 'video_1' },
                ]);
                setClips([
                  { id: `clip_v_${Date.now()}`, assetId: bridgeAssetId, trackId: 'video_1', startTime: 0, duration, inPoint: 0, outPoint: duration, name: recording.title || 'Video', videoUrl },
                  { id: `clip_a_${Date.now()}`, assetId: bridgeAssetId, trackId: 'audio_1', startTime: 0, duration, inPoint: 0, outPoint: duration, name: recording.title || 'Audio', videoUrl },
                ]);
                setTimeout(() => {
                  if (!cancelled && videoRef.current) {
                    videoRef.current.src = videoUrl;
                    videoRef.current.load();
                  }
                }, 100);
              }
            }
          }
        } else {
          console.error('[editor] Project not found for id:', projectId);
        }
      }
    };

    loadProject();
    return () => { cancelled = true; };
  }, [projectId, searchParams]);

  // ============================================================================
  // VIDEO SYNC
  // ============================================================================

  // Sync video time with playhead
  useEffect(() => {
    const video = videoRef.current;
    if (!video || clips.length === 0) return;

    // Find first unmuted video track clip at playhead position
    const videoTracks = tracks.filter(t => t.type === 'video' && !t.muted);
    let currentClip = clips.find(
      (c) => videoTracks.some(t => t.id === c.trackId) &&
             playheadTime >= c.startTime && 
             playheadTime < c.startTime + c.duration
    );

    // If no video, try first unmuted audio track
    if (!currentClip) {
      const audioTracks = tracks.filter(t => t.type === 'audio' && !t.muted);
      currentClip = clips.find(
        (c) => audioTracks.some(t => t.id === c.trackId) &&
               playheadTime >= c.startTime && 
               playheadTime < c.startTime + c.duration
      );
    }

    // Fallback to any clip
    if (!currentClip) {
      currentClip = clips[0];
    }

    if (currentClip) {
      // Change video source if different clip
      if (video.src !== currentClip.videoUrl) {
        video.src = currentClip.videoUrl;
        video.load(); // Force reload when source changes
      }
      
      // Sync video time to match clip position
      const clipTime = currentClip.inPoint + (playheadTime - currentClip.startTime);
      const targetTime = Math.max(0, Math.min(clipTime, currentClip.outPoint));
      
      // Only seek if difference is significant (avoid constant seeking during playback)
      if (Math.abs(video.currentTime - targetTime) > 0.3) {
        video.currentTime = targetTime;
      }
    }
  }, [playheadTime, clips, tracks]);

  // Playback animation loop
  useEffect(() => {
    if (isPlaying) {
      const startTime = performance.now();
      const startPlayhead = playheadTime;

      const animate = (currentTime: number) => {
        const elapsed = (currentTime - startTime) / 1000;
        const newTime = startPlayhead + elapsed;

        if (newTime >= totalDuration) {
          setPlayheadTime(totalDuration);
          setIsPlaying(false);
          videoRef.current?.pause();
          return;
        }

        setPlayheadTime(newTime);
        playAnimationRef.current = requestAnimationFrame(animate);
      };

      playAnimationRef.current = requestAnimationFrame(animate);
      videoRef.current?.play();
    } else {
      if (playAnimationRef.current) {
        cancelAnimationFrame(playAnimationRef.current);
      }
      videoRef.current?.pause();
    }

    return () => {
      if (playAnimationRef.current) {
        cancelAnimationFrame(playAnimationRef.current);
      }
    };
  }, [isPlaying, totalDuration]);

  // ============================================================================
  // KEYBOARD SHORTCUTS
  // ============================================================================

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger if typing in an input
      if (e.target instanceof HTMLInputElement) return;

      // Undo: Ctrl+Z / Cmd+Z
      if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        handleUndo();
        return;
      }
      // Redo: Ctrl+Shift+Z / Cmd+Shift+Z  or  Ctrl+Y / Cmd+Y
      if ((e.ctrlKey || e.metaKey) && ((e.key === "z" && e.shiftKey) || e.key === "y")) {
        e.preventDefault();
        handleRedo();
        return;
      }

      switch (e.key) {
        case " ":
          e.preventDefault();
          setIsPlaying((p) => !p);
          break;
        case "s":
        case "S":
          if (!e.metaKey && !e.ctrlKey) {
            handleSplit();
          }
          break;
        case "Delete":
        case "Backspace":
          if (selectedClipId) {
            handleDelete();
          }
          break;
        case "ArrowLeft":
          setPlayheadTime((t) => Math.max(0, t - (e.shiftKey ? 5 : 1)));
          break;
        case "ArrowRight":
          setPlayheadTime((t) => Math.min(totalDuration, t + (e.shiftKey ? 5 : 1)));
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedClipId, totalDuration, handleUndo, handleRedo]);

  // ============================================================================
  // TRACK MANAGEMENT
  // ============================================================================

  const toggleTrackMute = useCallback((trackId: string) => {
    setTracks(tracks.map(t => t.id === trackId ? { ...t, muted: !t.muted } : t));
  }, [tracks]);

  const toggleTrackLock = useCallback((trackId: string) => {
    setTracks(tracks.map(t => t.id === trackId ? { ...t, locked: !t.locked } : t));
  }, [tracks]);

  const toggleTrackSolo = useCallback((trackId: string) => {
    const track = tracks.find(t => t.id === trackId);
    if (!track) return;
    
    // If toggling solo on, mute all others; if toggling solo off, unmute all
    if (!track.solo) {
      setTracks(tracks.map(t => ({ ...t, muted: t.id !== trackId, solo: t.id === trackId })));
    } else {
      setTracks(tracks.map(t => ({ ...t, muted: false, solo: false })));
    }
  }, [tracks]);

  const toggleTrackLink = useCallback((trackId: string) => {
    const track = tracks.find(t => t.id === trackId);
    if (!track) return;

    if (track.linkedTrackId) {
      // Unlink: remove link from both tracks
      setTracks(tracks.map(t => {
        if (t.id === trackId || t.id === track.linkedTrackId) {
          return { ...t, linkedTrackId: null };
        }
        return t;
      }));
    } else {
      // Link: find first unlinked track of opposite type and link
      const oppositeType = track.type === 'video' ? 'audio' : 'video';
      const targetTrack = tracks.find(t => t.type === oppositeType && !t.linkedTrackId);
      
      if (targetTrack) {
        setTracks(tracks.map(t => {
          if (t.id === trackId) return { ...t, linkedTrackId: targetTrack.id };
          if (t.id === targetTrack.id) return { ...t, linkedTrackId: trackId };
          return t;
        }));
      }
    }
  }, [tracks]);

  const deleteTrack = useCallback((trackId: string) => {
    // Prevent deletion if it's the last video or last audio track
    const videoTracks = tracks.filter(t => t.type === 'video');
    const audioTracks = tracks.filter(t => t.type === 'audio');
    const trackToDelete = tracks.find(t => t.id === trackId);

    if (!trackToDelete) return;
    if (trackToDelete.type === 'video' && videoTracks.length === 1) {
      alert("Cannot delete the last video track");
      return;
    }
    if (trackToDelete.type === 'audio' && audioTracks.length === 1) {
      alert("Cannot delete the last audio track");
      return;
    }

    // Remove track and all its clips, and unlink any paired track
    setTracks(tracks
      .filter(t => t.id !== trackId)
      .map(t => t.linkedTrackId === trackId ? { ...t, linkedTrackId: null } : t)
    );
    setClips(clips.filter(c => c.trackId !== trackId));
  }, [tracks, clips]);

  const addVideoTrack = useCallback(() => {
    const maxTracks = getFeatureValue("editing.maxTracks") || 6;
    const maxVideoTracks = Math.ceil(maxTracks / 2);
    const videoTracks = tracks.filter(t => t.type === 'video');
    if (videoTracks.length >= maxVideoTracks) {
      alert(`Your plan allows ${maxVideoTracks} video tracks. Upgrade for more!`);
      return;
    }
    const newTrack: Track = {
      id: `video_${Date.now()}`,
      name: `Video ${videoTracks.length + 1}`,
      type: 'video',
      muted: false,
      locked: false,
      solo: false,
      linkedTrackId: null,
    };
    setTracks([...tracks, newTrack]);
  }, [tracks]);

  const addAudioTrack = useCallback(() => {
    const maxTracks = getFeatureValue("editing.maxTracks") || 6;
    const maxAudioTracks = Math.floor(maxTracks / 2);
    const audioTracks = tracks.filter(t => t.type === 'audio');
    if (audioTracks.length >= maxAudioTracks) {
      alert(`Your plan allows ${maxAudioTracks} audio tracks. Upgrade for more!`);
      return;
    }
    const newTrack: Track = {
      id: `audio_${Date.now()}`,
      name: `Audio ${audioTracks.length + 1}`,
      type: 'audio',
      muted: false,
      locked: false,
      solo: false,
      linkedTrackId: null,
    };
    setTracks([...tracks, newTrack]);
  }, [tracks]);

  // ============================================================================
  // EDITING OPERATIONS
  // ============================================================================

  const handleSplit = useCallback(() => {
    const clipAtPlayhead = clips.find(
      (c) => playheadTime > c.startTime && playheadTime < c.startTime + c.duration
    );

    if (!clipAtPlayhead) {
      return; // Playhead not in a clip
    }

    const clipTrack = tracks.find(t => t.id === clipAtPlayhead.trackId);
    if (!clipTrack || clipTrack.locked) {
      return; // Track locked, cannot edit
    }

    pushUndoSnapshot();

    const splitPoint = playheadTime - clipAtPlayhead.startTime;

    const clip1: TimelineClip = {
      ...clipAtPlayhead,
      duration: splitPoint,
      outPoint: clipAtPlayhead.inPoint + splitPoint,
    };

    const clip2: TimelineClip = {
      ...clipAtPlayhead,
      id: `clip_${Date.now()}`,
      startTime: playheadTime,
      duration: clipAtPlayhead.duration - splitPoint,
      inPoint: clipAtPlayhead.inPoint + splitPoint,
    };

    let newClips = clips.map((c) => (c.id === clipAtPlayhead.id ? clip1 : c)).concat(clip2);

    // If track is linked, also split the corresponding clip on linked track
    if (clipTrack.linkedTrackId) {
      const linkedClip = clips.find(c => c.trackId === clipTrack.linkedTrackId && c.startTime === clipAtPlayhead.startTime);
      if (linkedClip) {
        const linkedClip1: TimelineClip = {
          ...linkedClip,
          duration: splitPoint,
          outPoint: linkedClip.inPoint + splitPoint,
        };
        const linkedClip2: TimelineClip = {
          ...linkedClip,
          id: `clip_${Date.now() + 1}`,
          startTime: playheadTime,
          duration: linkedClip.duration - splitPoint,
          inPoint: linkedClip.inPoint + splitPoint,
        };
        newClips = newClips.map(c => c.id === linkedClip.id ? linkedClip1 : c).concat(linkedClip2);
      }
    }

    setClips(newClips);
  }, [clips, playheadTime, tracks, pushUndoSnapshot]);

  const handleTrim = useCallback(() => {
    if (!selectedClipId) return;

    const clip = clips.find((c) => c.id === selectedClipId);
    if (!clip) return;

    const clipTrack = tracks.find(t => t.id === clip.trackId);
    if (!clipTrack || clipTrack.locked) {
      return; // Track locked, cannot edit
    }

    // Trim from playhead to end of clip
    if (playheadTime > clip.startTime && playheadTime < clip.startTime + clip.duration) {
      pushUndoSnapshot();
      const newDuration = playheadTime - clip.startTime;
      let newClips = clips.map((c) =>
        c.id === selectedClipId
          ? { ...c, duration: newDuration, outPoint: c.inPoint + newDuration }
          : c
      );

      // If track is linked, also trim the corresponding clip on linked track
      if (clipTrack.linkedTrackId) {
        const linkedClip = clips.find(c => c.trackId === clipTrack.linkedTrackId && c.startTime === clip.startTime);
        if (linkedClip) {
          newClips = newClips.map(c =>
            c.id === linkedClip.id
              ? { ...c, duration: newDuration, outPoint: c.inPoint + newDuration }
              : c
          );
        }
      }

      setClips(newClips);
    }
  }, [clips, selectedClipId, playheadTime, tracks, pushUndoSnapshot]);

  const handleDelete = useCallback(() => {
    if (!selectedClipId) return;
    
    const clip = clips.find((c) => c.id === selectedClipId);
    if (!clip) return;

    const clipTrack = tracks.find(t => t.id === clip.trackId);
    if (!clipTrack || clipTrack.locked) {
      return; // Track locked, cannot edit
    }

    pushUndoSnapshot();

    let clipsToRemove = [selectedClipId];

    // If track is linked, also delete the corresponding clip on linked track
    if (clipTrack.linkedTrackId) {
      const linkedClip = clips.find(c => c.trackId === clipTrack.linkedTrackId && c.startTime === clip.startTime);
      if (linkedClip) {
        clipsToRemove.push(linkedClip.id);
      }
    }

    setClips(clips.filter((c) => !clipsToRemove.includes(c.id)));
    setSelectedClipId(null);
  }, [clips, selectedClipId, tracks, pushUndoSnapshot]);

  const handleSave = async () => {
    setSaveStatus('saving');
    try {
      // If this is a "new" project, create a real project first.
      let actualProjectId = projectId;
      if (actualProjectId === "new") {
        const firstClip = clips[0];
        const created = await editingApi.createProject({
          name: projectName || "Untitled Project",
          ...(firstClip?.assetId ? { assetId: firstClip.assetId } : {}),
        });
        actualProjectId = created.id;
        nav(`/editing/editor/${created.id}`, { replace: true });
      } else {
        // Keep server project name in sync
        if (actualProjectId) {
          await editingApi.updateProject(actualProjectId, { name: projectName });
        }
      }

      await editingApi.saveTimeline(actualProjectId!, clips, tracks);
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 2000);
    } catch (error) {
      console.error('Save failed:', error);
      setSaveStatus('error');
      setTimeout(() => setSaveStatus('idle'), 3000);
    }
  };

  const handleExport = async () => {
    try {
      // Ensure project exists + timeline is persisted before exporting
      let actualProjectId = projectId;
      if (actualProjectId === "new") {
        const firstClip = clips[0];
        const created = await editingApi.createProject({
          name: projectName || "Untitled Project",
          ...(firstClip?.assetId ? { assetId: firstClip.assetId } : {}),
        });
        actualProjectId = created.id;
        await editingApi.saveTimeline(actualProjectId!, clips, tracks);
        nav(`/editing/export/${created.id}`, { replace: true });
        return;
      }

      if (actualProjectId) {
        await editingApi.updateProject(actualProjectId, { name: projectName });
        await editingApi.saveTimeline(actualProjectId, clips, tracks);
        nav(`/editing/export/${actualProjectId}`);
      }
    } catch (e) {
      console.error("Export prep failed:", e);
      alert("Could not start export. Please try saving again.");
    }
  };

  // ============================================================================
  // UPLOAD TO PROJECT
  // ============================================================================

  const handleFileUpload = useCallback(async (file: File) => {
    if (!projectId || projectId === "new") {
      alert("Save the project first before uploading additional media.");
      return;
    }
    const allowed = ["video/mp4", "video/webm", "video/quicktime", "video/x-msvideo"];
    if (!allowed.includes(file.type)) {
      alert("Only MP4, WebM, MOV, and AVI files are supported.");
      return;
    }
    if (file.size > 500 * 1024 * 1024) {
      alert("File too large. Maximum size is 500 MB.");
      return;
    }

    setUploading(true);
    try {
      const title = file.name.replace(/\.[^/.]+$/, "");
      const asset = await uploadAssetToProject(projectId, file, title);

      // Get download URL for the new asset
      let downloadUrl = "";
      try {
        const result = await getAssetDownloadUrl(projectId, asset.id);
        downloadUrl = result.downloadUrl;
      } catch { /* non-fatal */ }

      // Find the end of existing clips
      const endTime = clips.reduce((max, c) => Math.max(max, c.startTime + c.duration), 0);
      const duration = asset.duration || 60;

      pushUndoSnapshot();

      // Add video + audio clip pair
      setClips(prev => [
        ...prev,
        {
          id: `clip_v_${asset.id}`,
          assetId: asset.id,
          trackId: 'video_1',
          startTime: endTime,
          duration,
          inPoint: 0,
          outPoint: duration,
          name: asset.filename || title,
          videoUrl: downloadUrl,
        },
        {
          id: `clip_a_${asset.id}`,
          assetId: asset.id,
          trackId: 'audio_1',
          startTime: endTime,
          duration,
          inPoint: 0,
          outPoint: duration,
          name: asset.filename || title,
          videoUrl: downloadUrl,
        },
      ]);
    } catch (err: any) {
      console.error("Upload failed:", err);
      alert(err?.message || "Upload failed");
    } finally {
      setUploading(false);
    }
  }, [projectId, clips, pushUndoSnapshot]);

  // ============================================================================
  // ADD SAVED VIDEO TO TIMELINE
  // ============================================================================

  const openSavedVideosPicker = useCallback(async () => {
    setShowSavedVideosPicker(true);
    setLoadingSaved(true);
    try {
      const all = await editingApi.getRecordings();
      setSavedRecordings(all.filter(r => r.status === 'ready'));
    } catch {
      setSavedRecordings([]);
    } finally {
      setLoadingSaved(false);
    }
  }, []);

  const addSavedVideoToTimeline = useCallback((recording: Recording) => {
    pushUndoSnapshot();
    const endTime = clips.reduce((max, c) => Math.max(max, c.startTime + c.duration), 0);
    const duration = Math.min(recording.duration || 60, 600);
    const videoUrl = recording.videoUrl || '';
    const now = Date.now();

    setClips(prev => [
      ...prev,
      {
        id: `clip_v_${now}`,
        assetId: recording.id,
        trackId: 'video_1',
        startTime: endTime,
        duration,
        inPoint: 0,
        outPoint: duration,
        name: recording.title || 'Video',
        videoUrl,
      },
      {
        id: `clip_a_${now}`,
        assetId: recording.id,
        trackId: 'audio_1',
        startTime: endTime,
        duration,
        inPoint: 0,
        outPoint: duration,
        name: recording.title || 'Audio',
        videoUrl,
      },
    ]);
    setShowSavedVideosPicker(false);
  }, [clips, pushUndoSnapshot]);

  // ============================================================================
  // DRAG HANDLERS (TRIM + MOVE)
  // ============================================================================

  const handleDragStart = useCallback((
    e: React.MouseEvent,
    type: 'trim-left' | 'trim-right' | 'move',
    clip: TimelineClip,
  ) => {
    e.stopPropagation();
    e.preventDefault();
    const clipTrack = tracks.find(t => t.id === clip.trackId);
    if (clipTrack?.locked) return;
    pushUndoSnapshot();
    setDragState({ type, clipId: clip.id, startX: e.clientX, originalClip: { ...clip } });
  }, [tracks, pushUndoSnapshot]);

  useEffect(() => {
    if (!dragState) return;

    const handleMouseMove = (e: MouseEvent) => {
      const dx = e.clientX - dragState.startX;
      const timeDelta = dx / (PIXELS_PER_SECOND * zoom);
      const orig = dragState.originalClip;

      setClips(prev => prev.map(c => {
        if (c.id !== dragState.clipId) return c;

        if (dragState.type === 'trim-left') {
          const newStart = Math.max(0, orig.startTime + timeDelta);
          const maxShift = orig.duration - 0.1; // keep min 0.1s duration
          const clampedShift = Math.min(newStart - orig.startTime, maxShift);
          return {
            ...c,
            startTime: orig.startTime + clampedShift,
            duration: orig.duration - clampedShift,
            inPoint: orig.inPoint + clampedShift,
          };
        }

        if (dragState.type === 'trim-right') {
          const newDuration = Math.max(0.1, orig.duration + timeDelta);
          return {
            ...c,
            duration: newDuration,
            outPoint: orig.inPoint + newDuration,
          };
        }

        // move
        return {
          ...c,
          startTime: Math.max(0, orig.startTime + timeDelta),
        };
      }));
    };

    const handleMouseUp = () => {
      setDragState(null);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [dragState, zoom]);

  // ============================================================================
  // TIMELINE INTERACTION
  // ============================================================================

  const handleTimelineClick = (e: React.MouseEvent) => {
    if (!timelineRef.current) return;
    const rect = timelineRef.current.getBoundingClientRect();
    const scrollLeft = timelineRef.current.scrollLeft;
    const relX = e.clientX - rect.left + scrollLeft - TIMELINE_LEFT_GUTTER_PX;
    const clampedX = Math.max(0, relX);
    const newTime = clampedX / (PIXELS_PER_SECOND * zoom);
    setPlayheadTime(Math.max(0, Math.min(newTime, totalDuration || 60)));
  };

  // ============================================================================
  // FORMAT HELPERS
  // ============================================================================

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    const frames = Math.floor((seconds % 1) * 30);
    return `${mins}:${secs.toString().padStart(2, "0")}:${frames.toString().padStart(2, "0")}`;
  };

  // ============================================================================
  // RENDER
  // ============================================================================

  return (
    <div style={{
      height: '100vh',
      backgroundColor: '#000000',
      color: '#ffffff',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden'
    }}>
      {/* ====== TOP BAR ====== */}
      <div style={{
        height: '48px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingLeft: '16px',
        paddingRight: '16px',
        borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
        backgroundColor: 'rgba(10, 10, 10, 0.8)',
        backdropFilter: 'blur(10px)',
        WebkitBackdropFilter: 'blur(10px)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <button
            onClick={() => nav("/content")}
            style={{
              fontSize: '14px',
              color: '#9ca3af',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              transition: 'color 0.3s ease'
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = '#ffffff')}
            onMouseLeave={(e) => (e.currentTarget.style.color = '#9ca3af')}
          >
            ← My Content
          </button>
          <input
            type="text"
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            style={{
              backgroundColor: 'transparent',
              borderBottom: '2px solid transparent',
              paddingLeft: '8px',
              paddingRight: '8px',
              paddingTop: '4px',
              paddingBottom: '4px',
              fontSize: '14px',
              color: '#ffffff',
              border: 'none',
              outline: 'none',
              transition: 'border-color 0.3s ease'
            }}
            onFocus={(e) => (e.currentTarget.style.borderColor = '#dc2626')}
            onBlur={(e) => (e.currentTarget.style.borderColor = 'transparent')}
            onMouseEnter={(e) => {
              if (e.currentTarget !== document.activeElement) {
                e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.2)';
              }
            }}
            onMouseLeave={(e) => {
              if (e.currentTarget !== document.activeElement) {
                e.currentTarget.style.borderColor = 'transparent';
              }
            }}
          />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button
            onClick={handleSave}
            style={{
              fontSize: '14px',
              paddingLeft: '12px',
              paddingRight: '12px',
              paddingTop: '6px',
              paddingBottom: '6px',
              backgroundColor: 'rgba(30, 30, 30, 0.8)',
              color: '#ffffff',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              borderRadius: '6px',
              cursor: 'pointer',
              transition: 'all 0.3s ease',
              backdropFilter: 'blur(10px)',
              WebkitBackdropFilter: 'blur(10px)'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = 'rgba(50, 50, 50, 0.9)';
              e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.2)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'rgba(30, 30, 30, 0.8)';
              e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.1)';
            }}
          >
            {saveStatus === 'saving' ? "Saving..." : saveStatus === 'saved' ? "✅ Saved" : saveStatus === 'error' ? "❌ Failed" : "💾 Save"}
          </button>
          <button
            onClick={handleExport}
            style={{
              fontSize: '14px',
              paddingLeft: '12px',
              paddingRight: '12px',
              paddingTop: '6px',
              paddingBottom: '6px',
              backgroundImage: 'linear-gradient(to right, #dc2626, #ef4444)',
              color: '#ffffff',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              borderRadius: '6px',
              cursor: 'pointer',
              transition: 'all 0.3s ease',
              fontWeight: '500'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundImage = 'linear-gradient(to right, #b91c1c, #dc2626)';
              e.currentTarget.style.boxShadow = '0 0 20px rgba(220, 38, 38, 0.5)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundImage = 'linear-gradient(to right, #dc2626, #ef4444)';
              e.currentTarget.style.boxShadow = 'none';
            }}
          >
            Export →
          </button>
        </div>
      </div>

      {/* ====== MAIN LAYOUT ====== */}
      <div className="flex flex-1 overflow-hidden">
        {/* ====== LEFT SIDEBAR - TOOLS ====== */}
        <div className="w-52 border-r border-zinc-800 bg-zinc-900/50 p-4 flex flex-col overflow-y-auto">
          <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-3">
            Tools
          </h3>
          <div className="space-y-2">
            {/* Undo / Redo */}
            <div className="flex gap-2 mb-2">
              <button
                onClick={handleUndo}
                disabled={undoStack.current.length === 0}
                className="flex-1 px-3 py-2 text-sm bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg transition flex items-center justify-center gap-1"
                title="Undo (Ctrl+Z)"
              >
                <Undo2 size={14} /> Undo
              </button>
              <button
                onClick={handleRedo}
                disabled={redoStack.current.length === 0}
                className="flex-1 px-3 py-2 text-sm bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg transition flex items-center justify-center gap-1"
                title="Redo (Ctrl+Shift+Z)"
              >
                <Redo2 size={14} /> Redo
              </button>
            </div>
            <button
              onClick={handleSplit}
              className="w-full px-3 py-2 text-sm bg-indigo-600 hover:bg-indigo-500 rounded-lg transition flex items-center gap-2"
            >
              <span>✂️</span> Split at Playhead
              <span className="ml-auto text-xs text-indigo-300">S</span>
            </button>
            <button
              onClick={handleTrim}
              disabled={!selectedClipId}
              className="w-full px-3 py-2 text-sm bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg transition flex items-center gap-2"
            >
              <span>📏</span> Trim to Playhead
            </button>
            <button
              onClick={handleDelete}
              disabled={!selectedClipId}
              className="w-full px-3 py-2 text-sm bg-zinc-800 hover:bg-zinc-700 text-red-400 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg transition flex items-center gap-2"
            >
              <span>🗑️</span> Delete Clip
              <span className="ml-auto text-xs text-zinc-500">Del</span>
            </button>
          </div>

          {/* Selected Clip Info */}
          {selectedClip && (
            <div className="mt-4 p-3 bg-zinc-800/50 rounded-lg border border-indigo-500/30">
              <p className="text-xs text-zinc-400 mb-1">Selected:</p>
              <p className="text-sm font-medium truncate">{selectedClip.name}</p>
              <p className="text-xs text-zinc-500 mt-1">
                {formatTime(selectedClip.duration)} duration
              </p>
            </div>
          )}

          {/* TRACK MANAGEMENT SECTION */}
          <div className="mt-6 pt-4 border-t border-zinc-800">
            <h3 className="text-sm font-bold text-white uppercase tracking-wider mb-4">
              📹 Tracks
            </h3>
            
            <div className="space-y-4 max-h-72 overflow-y-auto">
              {/* VIDEO TRACKS HEADER */}
              {tracks.filter(t => t.type === 'video').length > 0 && (
                <div className="text-xs font-semibold text-blue-400 uppercase tracking-wide mb-2">
                  Video Tracks
                </div>
              )}
              
              {/* Group video tracks */}
              {tracks.filter(t => t.type === 'video').map((track) => (
                <div 
                  key={track.id}
                  className={`p-3 rounded-lg border transition-all ${
                    track.linkedTrackId
                      ? 'bg-blue-500/10 border-blue-500/40'
                      : 'bg-zinc-800 border-zinc-700'
                  }`}
                >
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex-1">
                      <span className="text-sm font-semibold text-white block">{track.name}</span>
                      <span className="text-xs text-zinc-400">🎬 Video</span>
                    </div>
                    {track.linkedTrackId && <span className="text-xs text-blue-400">🔗</span>}
                  </div>
                  
                  {/* Control buttons - 2 rows for better spacing */}
                  <div className="grid grid-cols-3 gap-2 mb-2">
                    <button
                      onClick={() => toggleTrackMute(track.id)}
                      className={`px-2 py-2 text-xs font-medium rounded transition ${
                        track.muted
                          ? 'bg-red-500 text-white'
                          : 'bg-zinc-700 text-zinc-300 hover:bg-zinc-600'
                      }`}
                      title="Mute"
                    >
                      {track.muted ? '🔇' : '🔊'}
                    </button>
                    <button
                      onClick={() => toggleTrackLock(track.id)}
                      className={`px-2 py-2 text-xs font-medium rounded transition ${
                        track.locked
                          ? 'bg-red-500 text-white'
                          : 'bg-zinc-700 text-zinc-300 hover:bg-zinc-600'
                      }`}
                      title="Lock"
                    >
                      {track.locked ? '🔒' : '🔓'}
                    </button>
                    <button
                      onClick={() => toggleTrackSolo(track.id)}
                      className={`px-2 py-2 text-xs font-medium rounded transition ${
                        track.solo
                          ? 'bg-green-600 text-white'
                          : 'bg-zinc-700 text-zinc-300 hover:bg-zinc-600'
                      }`}
                      title="Solo"
                    >
                      S
                    </button>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => toggleTrackLink(track.id)}
                      className="px-2 py-2 text-xs font-medium rounded bg-zinc-700 text-zinc-300 hover:bg-zinc-600 transition"
                      title={track.linkedTrackId ? 'Unlink' : 'Link'}
                    >
                      {track.linkedTrackId ? '🔗' : '🔓'} {track.linkedTrackId ? 'Linked' : 'Link'}
                    </button>
                    <button
                      onClick={() => deleteTrack(track.id)}
                      className="px-2 py-2 text-xs font-medium rounded bg-red-900/50 hover:bg-red-800 text-red-300 transition"
                      title="Delete"
                    >
                      ✕ Delete
                    </button>
                  </div>
                </div>
              ))}

              {/* AUDIO TRACKS HEADER */}
              {tracks.filter(t => t.type === 'audio').length > 0 && (
                <div className="text-xs font-semibold text-purple-400 uppercase tracking-wide mb-2 mt-4">
                  Audio Tracks
                </div>
              )}
              
              {/* Group audio tracks */}
              {tracks.filter(t => t.type === 'audio').map((track) => (
                <div 
                  key={track.id}
                  className={`p-3 rounded-lg border transition-all ${
                    track.linkedTrackId
                      ? 'bg-purple-500/10 border-purple-500/40'
                      : 'bg-zinc-800 border-zinc-700'
                  }`}
                >
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex-1">
                      <span className="text-sm font-semibold text-white block">{track.name}</span>
                      <span className="text-xs text-zinc-400">🎙️ Audio</span>
                    </div>
                    {track.linkedTrackId && <span className="text-xs text-purple-400">🔗</span>}
                  </div>
                  
                  {/* Control buttons - 2 rows for better spacing */}
                  <div className="grid grid-cols-3 gap-2 mb-2">
                    <button
                      onClick={() => toggleTrackMute(track.id)}
                      className={`px-2 py-2 text-xs font-medium rounded transition ${
                        track.muted
                          ? 'bg-red-500 text-white'
                          : 'bg-zinc-700 text-zinc-300 hover:bg-zinc-600'
                      }`}
                      title="Mute"
                    >
                      {track.muted ? '🔇' : '🔊'}
                    </button>
                    <button
                      onClick={() => toggleTrackLock(track.id)}
                      className={`px-2 py-2 text-xs font-medium rounded transition ${
                        track.locked
                          ? 'bg-red-500 text-white'
                          : 'bg-zinc-700 text-zinc-300 hover:bg-zinc-600'
                      }`}
                      title="Lock"
                    >
                      {track.locked ? '🔒' : '🔓'}
                    </button>
                    <button
                      onClick={() => toggleTrackSolo(track.id)}
                      className={`px-2 py-2 text-xs font-medium rounded transition ${
                        track.solo
                          ? 'bg-green-600 text-white'
                          : 'bg-zinc-700 text-zinc-300 hover:bg-zinc-600'
                      }`}
                      title="Solo"
                    >
                      S
                    </button>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => toggleTrackLink(track.id)}
                      className="px-2 py-2 text-xs font-medium rounded bg-zinc-700 text-zinc-300 hover:bg-zinc-600 transition"
                      title={track.linkedTrackId ? 'Unlink' : 'Link'}
                    >
                      {track.linkedTrackId ? '🔗' : '🔓'} {track.linkedTrackId ? 'Linked' : 'Link'}
                    </button>
                    <button
                      onClick={() => deleteTrack(track.id)}
                      className="px-2 py-2 text-xs font-medium rounded bg-red-900/50 hover:bg-red-800 text-red-300 transition"
                      title="Delete"
                    >
                      ✕ Delete
                    </button>
                  </div>
                </div>
              ))}

              {/* Add Track Buttons */}
              <div className="space-y-2 mt-4 pt-4 border-t border-zinc-700">
                {tracks.filter(t => t.type === 'video').length < 3 && (
                  <button
                    onClick={addVideoTrack}
                    className="w-full px-3 py-2 text-sm font-medium rounded-lg bg-blue-600 hover:bg-blue-500 text-white transition"
                  >
                    + Add Video Track
                  </button>
                )}

                {tracks.filter(t => t.type === 'audio').length < 3 && (
                  <button
                    onClick={addAudioTrack}
                    className="w-full px-3 py-2 text-sm font-medium rounded-lg bg-purple-600 hover:bg-purple-500 text-white transition"
                  >
                    + Add Audio Track
                  </button>
                )}

                {projectId && projectId !== "new" && (
                  <>
                    <input
                      type="file"
                      ref={fileInputRef2}
                      accept="video/mp4,video/webm,video/quicktime,video/x-msvideo"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleFileUpload(file);
                        e.target.value = "";
                      }}
                    />
                  </>
                )}

                {/* Add Asset dropdown */}
                <div className="relative">
                  <button
                    onClick={() => setShowAddAssetMenu(!showAddAssetMenu)}
                    className="w-full px-3 py-2 text-sm font-medium rounded-lg bg-green-600 hover:bg-green-500 text-white transition flex items-center justify-center gap-2"
                  >
                    <Upload size={14} />
                    Add Asset ▾
                  </button>
                  {showAddAssetMenu && (
                    <div className="absolute left-0 right-0 mt-1 bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl z-50 overflow-hidden">
                      <button
                        onClick={() => { setShowAddAssetMenu(false); openSavedVideosPicker(); }}
                        className="w-full px-3 py-2 text-sm text-left text-zinc-200 hover:bg-zinc-700 transition flex items-center gap-2"
                      >
                        🎬 Saved Videos
                      </button>
                      <button
                        onClick={() => {
                          setShowAddAssetMenu(false);
                          if (projectId && projectId !== "new") {
                            fileInputRef2.current?.click();
                          } else {
                            alert("Save the project first before uploading media.");
                          }
                        }}
                        disabled={uploading}
                        className="w-full px-3 py-2 text-sm text-left text-zinc-200 hover:bg-zinc-700 disabled:opacity-50 transition flex items-center gap-2 border-t border-zinc-700"
                      >
                        ⬆️ {uploading ? "Uploading..." : "Upload From Device"}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Spacer */}
          <div className="flex-1" />

          {/* Plan Info */}
          <div className="pt-4 border-t border-zinc-800 text-xs text-zinc-500">
            <p className="font-medium text-zinc-400 mb-2">Plan Limits</p>
            <p>Max Tracks: {getFeatureValue("editing.maxTracks") || 6} total</p>
            <p className="text-[10px] text-zinc-600">
              ({Math.ceil((getFeatureValue("editing.maxTracks") || 6) / 2)}V + {Math.floor((getFeatureValue("editing.maxTracks") || 6) / 2)}A)
            </p>
            <p>Max Projects: {getFeatureValue("editing.maxProjects")}</p>
          </div>
        </div>

        {/* ====== CENTER - PREVIEW + TIMELINE ====== */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Video Preview */}
          <div className="bg-black flex items-center justify-center p-4" style={{ maxHeight: '45vh', minHeight: '120px' }}>
            {clips.length > 0 ? (
              <video
                key={clips[0]?.id || 'no-clip'}
                ref={videoRef}
                src={clips[0]?.videoUrl || SAMPLE_VIDEO_URL}
                className="max-h-full max-w-full rounded shadow-2xl object-contain"
                style={{
                  maxHeight: '100%',
                  maxWidth: '100%',
                  borderRadius: '8px'
                }}
                playsInline
                controls
                controlsList="nodownload"
                onError={(e) => {
                  console.error('❌ Video error:', e);
                  console.log('Video src:', videoRef.current?.src);
                }}
                onCanPlay={() => {
                  console.log('✅ Video can play:', clips[0]?.videoUrl);
                }}
              />
            ) : (
              <div className="text-zinc-600 text-center">
                <p className="text-4xl mb-2">🎬</p>
                <p>No clips in timeline</p>
              </div>
            )}
          </div>

          {/* Playback Controls */}
          <div className="h-14 px-4 flex items-center gap-4 border-t border-zinc-800 bg-zinc-900/50">
            <button
              onClick={() => setPlayheadTime(0)}
              className="p-2 text-zinc-400 hover:text-white transition"
              title="Go to start"
            >
              ⏮
            </button>
            <button
              onClick={() => setIsPlaying(!isPlaying)}
              className="w-10 h-10 bg-indigo-600 hover:bg-indigo-500 rounded-full flex items-center justify-center transition"
            >
              {isPlaying ? "⏸" : "▶"}
            </button>
            <button
              onClick={() => setPlayheadTime(totalDuration)}
              className="p-2 text-zinc-400 hover:text-white transition"
              title="Go to end"
            >
              ⏭
            </button>

            <div className="font-mono text-sm bg-zinc-800 px-3 py-1 rounded">
              {formatTime(playheadTime)}
              <span className="text-zinc-500 mx-1">/</span>
              {formatTime(totalDuration || 0)}
            </div>

            <div className="flex-1" />

            {/* Zoom Controls */}
            <div className="flex items-center gap-2 text-sm">
              <button
                onClick={() => setZoom(Math.max(0.25, zoom - 0.25))}
                className="w-7 h-7 bg-zinc-800 hover:bg-zinc-700 rounded transition"
              >
                −
              </button>
              <span className="w-12 text-center text-zinc-400">{Math.round(zoom * 100)}%</span>
              <button
                onClick={() => setZoom(Math.min(4, zoom + 0.25))}
                className="w-7 h-7 bg-zinc-800 hover:bg-zinc-700 rounded transition"
              >
                +
              </button>
            </div>
          </div>

          {/* ====== TIMELINE ====== */}
          <div className="flex-1 border-t border-zinc-800 bg-zinc-950 overflow-hidden flex flex-col" style={{ minHeight: '240px' }}>
            {/* Timeline container with dynamic height based on track count */}
            <div className="flex-1 overflow-auto">
              <div
                ref={timelineRef}
                className="h-full overflow-x-auto overflow-y-auto"
                onClick={handleTimelineClick}
              >
                {/* Calculate timeline dimensions */}
                {(() => {
                  const RULER_HEIGHT = 32;
                  const TRACK_HEIGHT = 100;
                  const timelineHeight = RULER_HEIGHT + (sortedTracks.length * TRACK_HEIGHT);
                  
                  return (
                    <div
                      className="relative"
                      style={{ width: `${timelineWidth}px`, minWidth: "100%", height: `${timelineHeight}px` }}
                    >
                      {/* TIME RULER - spans all tracks */}
                      <div className="absolute top-0 left-0 right-0 h-8 bg-gradient-to-b from-zinc-800 to-zinc-900 border-b-2 border-zinc-700 z-50">
                        {/* Major time markers (every 5 seconds) */}
                        {Array.from({ length: Math.ceil((totalDuration || 60) / 5) + 1 }).map((_, i) => {
                          const timeInSeconds = i * 5;
                          const pixelPosition = 80 + timeInSeconds * PIXELS_PER_SECOND * zoom;
                          const minutes = Math.floor(timeInSeconds / 60);
                          const seconds = timeInSeconds % 60;
                          const timeLabel = `${minutes}:${seconds.toString().padStart(2, '0')}`;
                          
                          return (
                            <div
                              key={i}
                              className="absolute top-0 bottom-0 flex flex-col items-center justify-end pb-0.5"
                              style={{ left: `${pixelPosition}px`, width: '1px' }}
                            >
                              <div className="w-px h-3 bg-zinc-500" />
                              <span className="absolute -top-5 left-1/2 -translate-x-1/2 text-[9px] font-medium text-zinc-400 whitespace-nowrap">
                                {timeLabel}
                              </span>
                            </div>
                          );
                        })}

                        {/* Minor time markers (every 1 second) */}
                        {Array.from({ length: Math.ceil(totalDuration || 60) + 1 }).map((_, i) => {
                          if (i % 5 === 0) return null;
                          const timeInSeconds = i;
                          const pixelPosition = 80 + timeInSeconds * PIXELS_PER_SECOND * zoom;
                          
                          return (
                            <div
                              key={`minor-${i}`}
                              className="absolute top-0 bottom-0"
                              style={{ left: `${pixelPosition}px`, width: '1px' }}
                            >
                              <div className="w-px h-1.5 bg-zinc-700" />
                            </div>
                          );
                        })}

                        {/* Grid lines every 5 seconds */}
                        {Array.from({ length: Math.ceil((totalDuration || 60) / 5) + 1 }).map((_, i) => {
                          const timeInSeconds = i * 5;
                          const pixelPosition = 80 + timeInSeconds * PIXELS_PER_SECOND * zoom;
                          
                          return (
                            <div
                              key={`grid-${i}`}
                              className="absolute top-0 bottom-0 w-px bg-zinc-800/40 pointer-events-none"
                              style={{ left: `${pixelPosition}px` }}
                            />
                          );
                        })}
                      </div>

                      {/* TRACKS - Video then Audio */}
                      {sortedTracks.map((track, trackIndex) => {
                        const trackY = RULER_HEIGHT + (trackIndex * TRACK_HEIGHT);
                        const trackClips = clips.filter(c => c.trackId === track.id);
                        const linkedTrack = tracks.find(t => t.id === track.linkedTrackId);
                        const isLinked = !!track.linkedTrackId;

                        return (
                          <div key={track.id}>
                            {/* TRACK LABEL */}
                            <div 
                              className={`absolute left-0 w-32 flex flex-col items-center justify-center text-xs font-semibold z-40 border-r transition-all ${
                                isLinked 
                                  ? 'bg-gradient-to-r from-blue-900/40 to-zinc-900 border-blue-500/50' 
                                  : track.type === 'video'
                                  ? 'bg-gradient-to-r from-blue-950/30 to-zinc-900 border-zinc-700'
                                  : 'bg-gradient-to-r from-purple-950/30 to-zinc-900 border-zinc-700'
                              } ${track.muted ? 'opacity-60' : ''} ${track.locked ? 'opacity-50' : ''}`}
                              style={{ top: `${trackY}px`, height: `${TRACK_HEIGHT}px`, borderBottom: '1px solid rgba(113, 113, 122, 0.5)' }}
                            >
                              <div className="text-center w-full px-2">
                                <p className="text-sm font-bold text-white truncate">{track.name}</p>
                                <p className="text-lg mt-1">
                                  {track.type === 'video' ? '🎬' : '🎙️'}
                                </p>
                                {isLinked && <p className="text-[10px] text-blue-300 mt-0.5">🔗 Linked</p>}
                                {track.muted && <p className="text-[10px] text-red-400 mt-0.5">Muted</p>}
                                {track.locked && <p className="text-[10px] text-orange-400 mt-0.5">Locked</p>}
                              </div>
                            </div>

                            {/* TRACK BACKGROUND */}
                            <div 
                              className={`absolute left-20 right-0 border-b transition-colors ${
                                isLinked 
                                  ? 'bg-amber-500/5 border-amber-500/20' 
                                  : trackIndex % 2 === 0 
                                    ? 'bg-zinc-900/30 border-zinc-800' 
                                    : 'bg-zinc-900/10 border-zinc-800'
                              }`}
                              style={{ top: `${trackY}px`, height: `${TRACK_HEIGHT}px` }}
                            />

                            {/* CLIPS */}
                            {trackClips.map((clip) => (
                              <div
                                key={clip.id}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (!track.locked) setSelectedClipId(clip.id);
                                }}
                                onMouseDown={(e) => {
                                  // Only initiate move from the body area (not trim handles)
                                  if ((e.target as HTMLElement).dataset.trimHandle) return;
                                  if (e.button !== 0) return;
                                  if (track.locked) return;
                                  handleDragStart(e, 'move', clip);
                                }}
                                className={`absolute rounded-lg cursor-grab transition-all group ${
                                  dragState?.clipId === clip.id ? 'cursor-grabbing opacity-80 z-20' : ''
                                } ${
                                  selectedClipId === clip.id
                                    ? "bg-gradient-to-b from-indigo-400 to-indigo-600 ring-2 ring-indigo-300 ring-offset-2 ring-offset-zinc-950 shadow-lg shadow-indigo-500/50"
                                    : "bg-gradient-to-b from-indigo-500/90 to-indigo-700/90 hover:from-indigo-400/90 hover:to-indigo-600/90 shadow-md shadow-indigo-900/50"
                                } ${track.locked ? 'opacity-60 cursor-not-allowed' : ''}`}
                                style={{
                                  top: `${trackY + 12}px`,
                                  height: `${TRACK_HEIGHT - 24}px`,
                                  left: `${80 + clip.startTime * PIXELS_PER_SECOND * zoom}px`,
                                  width: `${Math.max(40, clip.duration * PIXELS_PER_SECOND * zoom)}px`,
                                }}
                              >
                                <div className="h-full flex flex-col justify-between p-2 overflow-hidden">
                                  <div className="overflow-hidden">
                                    <p className="text-xs font-semibold truncate text-white">{clip.name}</p>
                                  </div>
                                  <div className="flex items-center justify-between">
                                    <p className="text-[10px] text-indigo-100/80">{formatTime(clip.duration)}</p>
                                    <span className="text-[9px] text-indigo-200/60 opacity-0 group-hover:opacity-100 transition">
                                      {formatTime(clip.startTime)}
                                    </span>
                                  </div>
                                </div>
                                {/* Trim Handles - interactive */}
                                <div
                                  data-trim-handle="left"
                                  className="absolute left-0 top-0 bottom-0 w-2 bg-gradient-to-r from-yellow-400 to-yellow-400/0 cursor-ew-resize opacity-0 hover:opacity-100 group-hover:opacity-50 transition z-10"
                                  onMouseDown={(e) => handleDragStart(e, 'trim-left', clip)}
                                />
                                <div
                                  data-trim-handle="right"
                                  className="absolute right-0 top-0 bottom-0 w-2 bg-gradient-to-l from-yellow-400 to-yellow-400/0 cursor-ew-resize opacity-0 hover:opacity-100 group-hover:opacity-50 transition z-10"
                                  onMouseDown={(e) => handleDragStart(e, 'trim-right', clip)}
                                />
                                {selectedClipId === clip.id && (
                                  <div className="absolute -left-1.5 top-1/2 -translate-y-1/2 w-2 h-2 bg-yellow-300 rounded-full shadow-md" />
                                )}
                              </div>
                            ))}
                          </div>
                        );
                      })}

                      {/* PLAYHEAD */}
                      <div
                        className="absolute top-0 bottom-0 w-0.5 bg-gradient-to-b from-red-400 to-red-500 z-30 pointer-events-none shadow-lg shadow-red-500/50"
                        style={{ left: `${80 + playheadTime * PIXELS_PER_SECOND * zoom}px` }}
                      >
                        <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-red-400 rotate-45 shadow-md" />
                        <div className="absolute -top-6 left-1/2 -translate-x-1/2 bg-red-500 text-white px-1.5 py-0.5 rounded text-[9px] font-mono font-bold whitespace-nowrap shadow-lg">
                          {formatTime(playheadTime)}
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </div>
            </div>
          </div>
        </div>

        {/* ====== RIGHT SIDEBAR - EXPORT ====== */}
        <div className="w-56 border-l border-zinc-800 bg-zinc-900/50 p-4 flex flex-col">
          <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-3">
            Export Settings
          </h3>

          <div className="space-y-4">
            <div>
              <label className="block text-xs text-zinc-500 mb-1">Resolution</label>
              <select
                value={exportResolution}
                onChange={(e) => setExportResolution(e.target.value)}
                className="w-full px-2 py-1.5 bg-zinc-800 border border-zinc-700 rounded text-sm focus:outline-none focus:border-indigo-500"
              >
                <option value="720p">720p HD</option>
                <option
                  value="1080p"
                  disabled={getFeatureValue("export.maxResolution") === "720p"}
                >
                  1080p Full HD {getFeatureValue("export.maxResolution") === "720p" && "🔒"}
                </option>
                <option
                  value="4k"
                  disabled={getFeatureValue("export.maxResolution") !== "4k"}
                >
                  4K Ultra HD {getFeatureValue("export.maxResolution") !== "4k" && "🔒"}
                </option>
              </select>
            </div>

            <div>
              <label className="block text-xs text-zinc-500 mb-1">Format</label>
              <select
                value={exportFormat}
                onChange={(e) => setExportFormat(e.target.value)}
                className="w-full px-2 py-1.5 bg-zinc-800 border border-zinc-700 rounded text-sm focus:outline-none focus:border-indigo-500"
              >
                <option value="mp4">MP4</option>
                <option value="webm">WebM</option>
              </select>
            </div>

            <button
              onClick={handleExport}
              disabled={clips.length === 0}
              className="w-full py-2.5 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 disabled:from-zinc-700 disabled:to-zinc-700 rounded-lg text-sm font-medium transition"
            >
              Export Video →
            </button>
          </div>

          {/* Spacer */}
          <div className="flex-1" />

          {/* Project Info */}
          <div className="pt-4 border-t border-zinc-800 text-xs text-zinc-500">
            <p className="font-medium text-zinc-400 mb-2">Project Info</p>
            <p>Duration: {formatTime(totalDuration)}</p>
            <p>Clips: {clips.length}</p>
            <p className="mt-2 text-zinc-600">
              Tip: Ctrl+Z to undo, Space to play
            </p>
          </div>
        </div>
      </div>

      {/* Saved Videos Picker Overlay */}
      {showSavedVideosPicker && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 9999,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(0,0,0,0.7)",
            backdropFilter: "blur(4px)",
          }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowSavedVideosPicker(false); }}
        >
          <div
            style={{
              width: "min(620px, 90vw)",
              maxHeight: "70vh",
              background: "#1a1a2e",
              border: "1px solid rgba(255,255,255,0.15)",
              borderRadius: "0.75rem",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
              boxShadow: "0 24px 64px rgba(0,0,0,0.6)",
            }}
          >
            <div style={{ padding: "1rem 1.25rem", borderBottom: "1px solid rgba(255,255,255,0.1)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 style={{ color: "#fff", fontWeight: 700, fontSize: "1rem", margin: 0 }}>🎬 Saved Videos</h3>
              <button onClick={() => setShowSavedVideosPicker(false)} style={{ background: "none", border: "none", color: "#9ca3af", fontSize: "1.25rem", cursor: "pointer" }}>✕</button>
            </div>
            <div style={{ flex: 1, overflowY: "auto", padding: "0.75rem 1.25rem" }}>
              {loadingSaved ? (
                <p style={{ color: "#9ca3af", textAlign: "center", padding: "2rem" }}>Loading…</p>
              ) : savedRecordings.length === 0 ? (
                <p style={{ color: "#6b7280", textAlign: "center", padding: "2rem" }}>No saved videos found.</p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                  {savedRecordings.map((r) => (
                    <div
                      key={r.id}
                      style={{
                        display: "flex", alignItems: "center", gap: "0.75rem",
                        padding: "0.6rem 0.75rem", borderRadius: "0.5rem",
                        border: "1px solid rgba(255,255,255,0.08)", cursor: "pointer",
                        transition: "all 0.15s ease",
                      }}
                      onClick={() => addSavedVideoToTimeline(r)}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = "rgba(255,255,255,0.06)"; }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = "transparent"; }}
                    >
                      <div style={{ width: 72, height: 40, borderRadius: "0.375rem", overflow: "hidden", background: "#111", flexShrink: 0 }}>
                        {r.thumbnailUrl ? (
                          <img src={r.thumbnailUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                        ) : (
                          <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "#555", fontSize: "0.75rem" }}>🎬</div>
                        )}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: "0.8rem", color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.title}</div>
                        <div style={{ fontSize: "0.7rem", color: "#9ca3af" }}>
                          {Math.floor(r.duration / 60)}:{String(r.duration % 60).padStart(2, "0")}
                          {r.roomName ? ` • ${r.roomName}` : ""}
                        </div>
                      </div>
                      <span style={{ fontSize: "0.75rem", color: "#22c55e", fontWeight: 600 }}>+ Add</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div style={{ padding: "0.75rem 1.25rem", borderTop: "1px solid rgba(255,255,255,0.1)", display: "flex", justifyContent: "flex-end" }}>
              <button
                onClick={() => setShowSavedVideosPicker(false)}
                style={{ padding: "0.5rem 1rem", borderRadius: "0.375rem", background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.2)", color: "#ccc", cursor: "pointer", fontSize: "0.8rem" }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}