// ============================================================================
// EDITOR PAGE — Slim route wrapper: loads project, hydrates store, renders layout
// The old monolith has been decomposed into components/, store/, engine/
// ============================================================================

import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import {
  editingApi,
  type Recording,
  type TimelineClipRecord,
  type ProjectAssetRecord,
  type SavedVideo,
} from '../../../lib/editingApi';
import { apiFetchAuth } from '../../../lib/api';
import { API_BASE } from '../../../lib/apiBase';
import {
  listProjectAssets,
  getAssetDownloadUrl,
} from '../../../lib/projectsApi';
import type { ProjectAsset } from '../../../lib/projectsApi';
import { useEditingFeatures } from './useEditingFeatures';

import { useEditorStore } from './store/editorStore';
import type { TimelineClip, Track, SourceAsset } from './types';
import { generateId } from './types';
import EditorLayout from './components/EditorLayout';
import RawVideoViewer from './components/RawVideoViewer';

// ============================================================================
// HELPERS — Convert legacy formats to new model
// ============================================================================

function defaultTracks(): Track[] {
  return [
    { id: 'video_1', name: 'Video 1', type: 'video', order: 0, isMuted: false, isSolo: false, isLocked: false },
    { id: 'audio_1', name: 'Audio 1', type: 'audio', order: 1, isMuted: false, isSolo: false, isLocked: false },
  ];
}

/** Convert a recording to a pair of linked video + audio clips + a SourceAsset */
function recordingToClipsAndAsset(
  recording: { id: string; title?: string; videoUrl?: string; duration?: number },
  time = 0,
): { clips: TimelineClip[]; asset: SourceAsset } {
  const duration = Math.min(recording.duration || 60, 600);
  const url = recording.videoUrl || '';
  const linkedGroupId = generateId('link');

  const asset: SourceAsset = {
    id: recording.id,
    type: 'video',
    url,
    fileName: recording.title || 'Video',
    duration,
    hasVideo: true,
    hasAudio: true,
  };

  const clips: TimelineClip[] = [
    {
      id: generateId('clip_v'),
      assetId: recording.id,
      trackId: 'video_1',
      type: 'video',
      timelineStart: time,
      timelineEnd: time + duration,
      sourceStart: 0,
      sourceEnd: duration,
      linkedGroupId,
      isMuted: false,
      isHidden: false,
      displayName: recording.title || 'Video',
      volume: 1,
    },
    {
      id: generateId('clip_a'),
      assetId: recording.id,
      trackId: 'audio_1',
      type: 'audio',
      timelineStart: time,
      timelineEnd: time + duration,
      sourceStart: 0,
      sourceEnd: duration,
      linkedGroupId,
      isMuted: false,
      isHidden: false,
      displayName: recording.title || 'Audio',
      volume: 1,
    },
  ];

  return { clips, asset };
}

/** Convert an old model clip to the new format */
function legacyClipToNew(
  c: { id: string; assetId: string; trackId: string; startTime: number; duration: number; inPoint: number; outPoint: number; name: string; videoUrl?: string },
): TimelineClip {
  return {
    id: c.id,
    assetId: c.assetId,
    trackId: c.trackId,
    type: c.trackId.startsWith('audio') ? 'audio' : 'video',
    timelineStart: c.startTime,
    timelineEnd: c.startTime + c.duration,
    sourceStart: c.inPoint,
    sourceEnd: c.outPoint,
    linkedGroupId: null, // legacy didn't store this
    isMuted: false,
    isHidden: false,
    displayName: c.name || '',
    volume: 1,
  };
}

/** Convert 3-layer TimelineClipRecord (ms) to new model (seconds) */
function clipRecordToNew(
  tc: TimelineClipRecord,
  name: string,
): TimelineClip {
  return {
    id: tc.id,
    assetId: tc.projectAssetId,
    trackId: tc.trackId,
    type: tc.kind === 'audio' ? 'audio' : 'video',
    timelineStart: tc.startMs / 1000,
    timelineEnd: tc.endMs / 1000,
    sourceStart: tc.trimInMs / 1000,
    sourceEnd: tc.trimOutMs / 1000,
    linkedGroupId: null,
    isMuted: false,
    isHidden: false,
    displayName: name,
    volume: 1,
  };
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function EditorPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [searchParams] = useSearchParams();
  const { features } = useEditingFeatures();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const hydrate = useEditorStore(s => s.hydrateProject);
  const reset = useEditorStore(s => s.resetEditor);

  // Load project and hydrate store
  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError(null);

      try {
        if (projectId === 'new') {
          await loadNewProject(cancelled);
        } else if (projectId) {
          await loadExistingProject(projectId, cancelled);
        }
      } catch (err) {
        if (!cancelled) {
          console.error('[editor] Load failed:', err);
          setError('Failed to load project');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    // ── NEW PROJECT (from recording or asset) ──────────────────────────
    async function loadNewProject(cancelled: boolean) {
      const recordingId = searchParams.get('recordingId');
      const assetId = searchParams.get('assetId');

      if (recordingId) {
        const recording = await fetchRecording(recordingId);
        if (cancelled) return;
        if (recording) {
          const { clips, asset } = recordingToClipsAndAsset(recording);
          hydrate({
            projectId: null,
            projectName: `Edit: ${recording.title || 'Recording'}`,
            tracks: defaultTracks(),
            clips,
            assets: new Map([[asset.id, asset]]),
          });
          return;
        }
      }

      if (assetId) {
        let asset: any = null;
        try { asset = await editingApi.getAsset(assetId); } catch { /* */ }
        if (cancelled) return;
        if (asset) {
          const result = recordingToClipsAndAsset({
            id: assetId,
            title: asset.name,
            videoUrl: asset.videoUrl,
            duration: asset.duration,
          });
          hydrate({
            projectId: null,
            projectName: `Project: ${asset.name || 'Untitled'}`,
            tracks: defaultTracks(),
            clips: result.clips,
            assets: new Map([[result.asset.id, result.asset]]),
          });
          return;
        }
      }

      // Empty new project
      hydrate({
        projectId: null,
        projectName: 'Untitled Project',
        tracks: defaultTracks(),
        clips: [],
        assets: new Map(),
      });
    }

    // ── EXISTING PROJECT ───────────────────────────────────────────────
    async function loadExistingProject(id: string, cancelled: boolean) {
      let proj: any = null;
      try { proj = await editingApi.getProject(id); } catch (e) {
        console.error('[editor] getProject failed:', e);
      }
      if (cancelled) return;
      if (!proj) { setError('Project not found'); return; }

      // ── 3-LAYER ARCHITECTURE: Try /api/projects/:id ──
      let layeredData: {
        projectAssets?: ProjectAssetRecord[];
        timelineClips?: TimelineClipRecord[];
        savedVideos?: Record<string, Partial<SavedVideo>>;
      } | null = null;

      try {
        const res = await apiFetchAuth(
          `${API_BASE}/api/projects/${id}`,
          {},
          { allowNonOk: true },
        );
        if (res.ok) layeredData = await res.json();
      } catch (e) {
        console.warn('[editor] 3-layer fetch failed (non-fatal):', e);
      }
      if (cancelled) return;

      const layeredClips = layeredData?.timelineClips ?? [];
      const layeredAssets = layeredData?.projectAssets ?? [];
      const savedVideos = layeredData?.savedVideos ?? {};

      if (layeredClips.length > 0) {
        // Build URL + title maps from projectAssets → savedVideos
        const assetUrlMap = new Map<string, string>();
        const assetTitleMap = new Map<string, string>();
        for (const pa of layeredAssets) {
          const sv = savedVideos[pa.savedVideoId];
          if (sv?.playbackUrl) {
            assetUrlMap.set(pa.id, sv.playbackUrl);
            assetTitleMap.set(pa.id, sv.title || 'Clip');
          }
        }

        const clips = layeredClips.map(tc =>
          clipRecordToNew(tc, assetTitleMap.get(tc.projectAssetId) || (tc.kind === 'audio' ? 'Audio' : 'Video'))
        );

        // Build SourceAsset map
        const assets = new Map<string, SourceAsset>();
        for (const pa of layeredAssets) {
          assets.set(pa.id, {
            id: pa.id,
            type: 'video',
            url: assetUrlMap.get(pa.id) || '',
            fileName: assetTitleMap.get(pa.id) || 'Asset',
            duration: 60, // will be resolved from clips
            hasVideo: true,
            hasAudio: true,
          });
        }

        hydrate({
          projectId: id,
          projectName: proj.name || 'Untitled',
          tracks: defaultTracks(),
          clips,
          assets,
        });
        return;
      }

      // ── LEGACY PATH: project assets + timeline ──
      let projectAssets: ProjectAsset[] = [];
      try { projectAssets = await listProjectAssets(id); } catch { /* */ }
      if (cancelled) return;

      const readyAssets = projectAssets.filter(
        a => a.processingStatus === 'ready' && (a.type === 'recording' || a.type === 'upload')
      );

      // Build download URL map
      const urlMap = new Map<string, string>();
      await Promise.all(readyAssets.map(async (asset) => {
        try {
          const result = await getAssetDownloadUrl(id, asset.id);
          urlMap.set(asset.id, result.downloadUrl);
          if (asset.sourceRecordingId) urlMap.set(asset.sourceRecordingId, result.downloadUrl);
        } catch { /* */ }
      }));
      if (cancelled) return;

      // Check for saved timeline in project document
      const savedClips = (proj as any)?.timeline?.clips;
      const savedTrks = (proj as any)?.timeline?.tracks;

      if (Array.isArray(savedClips) && savedClips.length > 0) {
        // Has all clips have real URLs?
        const normalized = savedClips.map((c: any) => ({
          id: String(c?.id || generateId('clip')),
          assetId: String(c?.assetId || ''),
          trackId: typeof c?.trackId === 'string' ? c.trackId : 'video_1',
          startTime: Number(c?.startTime || 0),
          duration: Number(c?.duration || 0),
          inPoint: Number(c?.inPoint || 0),
          outPoint: Number(c?.outPoint || 0),
          name: String(c?.name || proj.name),
          videoUrl: urlMap.get(String(c?.assetId || '')) || String(c?.videoUrl || ''),
        }));

        const hasRealUrls = normalized.some((c: any) => c.videoUrl && c.videoUrl !== '');
        if (hasRealUrls) {
          const clips = normalized.map(legacyClipToNew);
          const assets = buildAssetsFromLegacyClips(normalized);

          // Restore tracks if available
          const tracks = Array.isArray(savedTrks) && savedTrks.length > 0
            ? savedTrks.map((t: any, idx: number) => ({
                id: String(t?.id || `track_${idx}`),
                name: String(t?.name || 'Track'),
                type: (t?.type === 'audio' ? 'audio' : 'video') as 'video' | 'audio',
                order: idx,
                isMuted: !!t?.muted,
                isSolo: !!t?.solo,
                isLocked: !!t?.locked,
              }))
            : defaultTracks();

          hydrate({ projectId: id, projectName: proj.name, tracks, clips, assets });
          return;
        }
      }

      // Auto-populate from ready project assets
      if (readyAssets.length > 0) {
        let currentTime = 0;
        const clips: TimelineClip[] = [];
        const assets = new Map<string, SourceAsset>();

        for (const asset of readyAssets) {
          const duration = asset.duration || 60;
          const downloadUrl = urlMap.get(asset.id) || '';
          const linkedGroupId = generateId('link');

          assets.set(asset.id, {
            id: asset.id,
            type: 'video',
            url: downloadUrl,
            fileName: asset.filename || 'Asset',
            duration,
            hasVideo: true,
            hasAudio: true,
          });

          clips.push({
            id: generateId('clip_v'),
            assetId: asset.id,
            trackId: 'video_1',
            type: 'video',
            timelineStart: currentTime,
            timelineEnd: currentTime + duration,
            sourceStart: 0,
            sourceEnd: duration,
            linkedGroupId,
            isMuted: false,
            isHidden: false,
            displayName: asset.filename || 'Video',
            volume: 1,
          });
          clips.push({
            id: generateId('clip_a'),
            assetId: asset.id,
            trackId: 'audio_1',
            type: 'audio',
            timelineStart: currentTime,
            timelineEnd: currentTime + duration,
            sourceStart: 0,
            sourceEnd: duration,
            linkedGroupId,
            isMuted: false,
            isHidden: false,
            displayName: asset.filename || 'Audio',
            volume: 1,
          });
          currentTime += duration;
        }

        hydrate({ projectId: id, projectName: proj.name, tracks: defaultTracks(), clips, assets });
        return;
      }

      // Last-resort fallback: bridge assetId as recording
      const bridgeAssetId = (proj as any)?.assetId;
      if (bridgeAssetId) {
        const recording = await fetchRecording(bridgeAssetId);
        if (cancelled) return;
        if (recording?.videoUrl) {
          const { clips, asset } = recordingToClipsAndAsset(recording);
          hydrate({
            projectId: id,
            projectName: proj.name,
            tracks: defaultTracks(),
            clips,
            assets: new Map([[asset.id, asset]]),
          });
          return;
        }
      }

      // Empty project
      hydrate({
        projectId: id,
        projectName: proj.name || 'Untitled',
        tracks: defaultTracks(),
        clips: [],
        assets: new Map(),
      });
    }

    load();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // Cleanup on unmount
  useEffect(() => {
    return () => reset();
  }, [reset]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-zinc-950 text-white">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-red-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-zinc-400 text-sm">Loading editor…</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-screen bg-zinc-950 text-white">
        <div className="text-center">
          <p className="text-red-400 text-lg mb-2">⚠ {error}</p>
          <button
            onClick={() => window.history.back()}
            className="text-sm text-zinc-400 hover:text-white underline"
          >
            Go back
          </button>
        </div>
      </div>
    );
  }

  // Determine view mode: raw viewer for assets from My Content, timeline for saved projects
  const isRawView = searchParams.get('view') === 'raw';

  return isRawView ? <RawVideoViewer /> : <EditorLayout />;
}

// ============================================================================
// PRIVATE HELPERS
// ============================================================================

/** Try multiple paths to fetch a recording */
async function fetchRecording(id: string): Promise<Recording | null> {
  try {
    const rec = await editingApi.getRecording(id);
    if (rec) return rec;
  } catch { /* */ }

  try {
    const res = await apiFetchAuth(`/api/editing/recordings/${id}`, {}, { allowNonOk: true });
    if (res.ok) return await res.json();
  } catch { /* */ }

  return null;
}

/** Build SourceAsset map from legacy clip format */
function buildAssetsFromLegacyClips(
  clips: Array<{ assetId: string; name: string; videoUrl: string; duration: number }>,
): Map<string, SourceAsset> {
  const assets = new Map<string, SourceAsset>();
  for (const c of clips) {
    if (!assets.has(c.assetId)) {
      assets.set(c.assetId, {
        id: c.assetId,
        type: 'video',
        url: c.videoUrl || '',
        fileName: c.name || 'Asset',
        duration: c.duration || 60,
        hasVideo: true,
        hasAudio: true,
      });
    }
  }
  return assets;
}
