// ============================================================================
// PROJECT I/O — server payload <-> editor store (pure)
// ============================================================================

import type { MediaAsset } from '../../../../lib/editingApi';
import type { EditorProjectPayload, EditorClipDTO, EditorTrackDTO } from '../../../../lib/projectsApi';
import type { TimelineClip, Track, SourceAsset } from '../types';
import { clampVolume } from '../types';
import { placeAssetOnTimeline } from './operations';

export function defaultTracks(): Track[] {
  return [
    { id: 'video_1', name: 'Video 1', type: 'video', order: 0, isMuted: false, isSolo: false, isLocked: false },
    { id: 'audio_1', name: 'Audio 1', type: 'audio', order: 1, isMuted: false, isSolo: false, isLocked: false },
  ];
}

/** MediaAsset (server) -> SourceAsset (editor store). */
export function mediaToSourceAsset(a: MediaAsset): SourceAsset {
  const type: SourceAsset['type'] = a.type === 'audio' ? 'audio' : a.type === 'image' ? 'image' : 'video';
  return {
    id: a.id,
    type,
    url: a.videoUrl || '',
    fileName: a.name || 'Asset',
    duration: a.duration > 0 ? a.duration : type === 'image' ? 5 : 60,
    hasVideo: type === 'image' ? false : a.hasVideo !== false && type === 'video',
    hasAudio: type !== 'image' && a.hasAudio !== false,
    thumbnailUrl: a.thumbnailUrl || undefined,
  };
}

/** Lay assets out back-to-back (linked video+audio pairs). */
export function sequence(assets: SourceAsset[], tracks: Track[]): TimelineClip[] {
  let clips: TimelineClip[] = [];
  let t = 0;
  for (const a of assets) {
    const { newClips } = placeAssetOnTimeline(a, t, tracks, clips);
    clips = [...clips, ...newClips];
    t = clips.reduce((max, c) => Math.max(max, c.timelineEnd), 0);
  }
  return clips;
}

/** Server payload -> store hydration data. */
export function payloadToEditorState(payload: EditorProjectPayload): {
  tracks: Track[];
  clips: TimelineClip[];
  assets: Map<string, SourceAsset>;
} {
  const assets = new Map<string, SourceAsset>();
  for (const [id, a] of Object.entries(payload.mediaAssets || {})) {
    assets.set(id, mediaToSourceAsset({ ...a, id }));
  }

  const t = payload.timeline;
  if (t && Array.isArray(t.clips)) {
    const tracks: Track[] = t.tracks.length ? t.tracks.map(tr => ({ ...tr })) : defaultTracks();
    const clips: TimelineClip[] = t.clips.map(c => ({ ...c, volume: clampVolume(c.volume ?? 1) }));
    // Clips whose media is gone keep their place (shown without a source).
    for (const c of clips) {
      if (!assets.has(c.assetId)) {
        assets.set(c.assetId, {
          id: c.assetId, type: c.type === 'audio' ? 'audio' : 'video', url: '',
          fileName: c.displayName || 'Missing media', duration: c.sourceEnd,
          hasVideo: c.type === 'video', hasAudio: true,
        });
      }
    }
    return { tracks, clips, assets };
  }

  // No timeline yet: start from the project's ready assets.
  const tracks = defaultTracks();
  const ready = (payload.projectAssets || [])
    .filter(pa => pa.processingStatus === 'ready')
    .map(pa => assets.get(pa.id))
    .filter((a): a is SourceAsset => !!a);
  return { tracks, clips: sequence(ready, tracks), assets };
}

/** Editor store -> timeline payload for PUT /api/projects/:id/timeline. */
export function editorStateToTimeline(
  clips: TimelineClip[],
  tracks: Track[],
): { tracks: EditorTrackDTO[]; clips: EditorClipDTO[] } {
  return {
    tracks: tracks.map(t => ({
      id: t.id, name: t.name, type: t.type, order: t.order,
      isMuted: t.isMuted, isSolo: t.isSolo, isLocked: t.isLocked,
    })),
    clips: clips.map(c => ({
      id: c.id,
      assetId: c.assetId,
      trackId: c.trackId,
      type: c.type,
      timelineStart: c.timelineStart,
      timelineEnd: c.timelineEnd,
      sourceStart: c.sourceStart,
      sourceEnd: c.sourceEnd,
      linkedGroupId: c.linkedGroupId,
      isMuted: c.isMuted,
      isHidden: c.isHidden,
      displayName: c.displayName,
      volume: clampVolume(c.volume),
      ...(c.audioDetached ? { audioDetached: true } : {}),
      ...(c.type === 'video' && c.transitionIn ? { transitionIn: { ...c.transitionIn } } : {}),
    })),
  };
}
