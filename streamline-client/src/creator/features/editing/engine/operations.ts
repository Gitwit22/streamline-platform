// ============================================================================
// EDITING OPERATIONS — Pure functions for timeline mutations
// All operations return new state; no side effects.
// ============================================================================

import type { TimelineClip, Track, SourceAsset } from '../types';
import { MIN_CLIP_DURATION, generateId } from '../types';

// ============================================================================
// ASSET PLACEMENT
// ============================================================================

/**
 * Place a source asset onto the timeline, creating linked video+audio clips.
 */
export function placeAssetOnTimeline(
  asset: SourceAsset,
  time: number,
  tracks: Track[],
  clips: TimelineClip[],
): { newClips: TimelineClip[] } {
  const linkedGroupId = asset.hasVideo && asset.hasAudio ? generateId('link') : null;
  const newClips: TimelineClip[] = [];
  const duration = asset.duration || 60;

  if (asset.hasVideo || asset.type === 'image') {
    const videoTrack = tracks
      .filter(t => t.type === 'video')
      .sort((a, b) => a.order - b.order)[0];
    if (videoTrack) {
      const clipDuration = asset.type === 'image' ? 5 : duration;
      newClips.push({
        id: generateId('clip_v'),
        assetId: asset.id,
        trackId: videoTrack.id,
        type: 'video',
        timelineStart: time,
        timelineEnd: time + clipDuration,
        sourceStart: 0,
        sourceEnd: clipDuration,
        linkedGroupId,
        isMuted: false,
        isHidden: false,
        displayName: asset.fileName || 'Video',
        volume: 1,
      });
    }
  }

  if (asset.hasAudio) {
    const audioTrack = tracks
      .filter(t => t.type === 'audio')
      .sort((a, b) => a.order - b.order)[0];
    if (audioTrack) {
      newClips.push({
        id: generateId('clip_a'),
        assetId: asset.id,
        trackId: audioTrack.id,
        type: 'audio',
        timelineStart: time,
        timelineEnd: time + duration,
        sourceStart: 0,
        sourceEnd: duration,
        linkedGroupId,
        isMuted: false,
        isHidden: false,
        displayName: asset.fileName || 'Audio',
        volume: 1,
      });
    }
  }

  return { newClips };
}

// ============================================================================
// CLIP OPERATIONS — All linked-group-aware
// ============================================================================

/** Get all clips in the same linked group */
function getLinkedClips(clipId: string, clips: TimelineClip[]): TimelineClip[] {
  const clip = clips.find(c => c.id === clipId);
  if (!clip || !clip.linkedGroupId) return clip ? [clip] : [];
  return clips.filter(c => c.linkedGroupId === clip.linkedGroupId);
}

/** Get all clip IDs that should be affected by an operation on a given clip */
function getAffectedIds(clipId: string, clips: TimelineClip[]): Set<string> {
  return new Set(getLinkedClips(clipId, clips).map(c => c.id));
}

/**
 * Move clips by a time delta. Propagates to linked partners.
 */
export function moveClips(
  clipIds: string[],
  timeDelta: number,
  clips: TimelineClip[],
): TimelineClip[] {
  // Collect all affected clip IDs (including linked partners)
  const affected = new Set<string>();
  for (const id of clipIds) {
    for (const aid of getAffectedIds(id, clips)) affected.add(aid);
  }

  // Calculate the minimum start time to prevent any clip going below 0
  const minStart = clips
    .filter(c => affected.has(c.id))
    .reduce((min, c) => Math.min(min, c.timelineStart), Infinity);
  const clampedDelta = Math.max(timeDelta, -minStart);

  return clips.map(c => {
    if (!affected.has(c.id)) return c;
    return {
      ...c,
      timelineStart: c.timelineStart + clampedDelta,
      timelineEnd: c.timelineEnd + clampedDelta,
    };
  });
}

/**
 * Trim the start of a clip (and linked partners).
 */
export function trimClipStart(
  clipId: string,
  newTimelineStart: number,
  clips: TimelineClip[],
  assets: Map<string, SourceAsset>,
): TimelineClip[] {
  const clip = clips.find(c => c.id === clipId);
  if (!clip) return clips;

  const affected = getAffectedIds(clipId, clips);

  return clips.map(c => {
    if (!affected.has(c.id)) return c;
    
    // Clamp: can't trim past the end, can't go below 0, can't trim before source start
    const clamped = Math.max(0, Math.min(newTimelineStart, c.timelineEnd - MIN_CLIP_DURATION));
    const delta = clamped - c.timelineStart;
    const newSourceStart = c.sourceStart + delta;
    
    // Don't let sourceStart go below 0
    if (newSourceStart < 0) return c;
    
    return {
      ...c,
      timelineStart: clamped,
      sourceStart: newSourceStart,
    };
  });
}

/**
 * Trim the end of a clip (and linked partners).
 */
export function trimClipEnd(
  clipId: string,
  newTimelineEnd: number,
  clips: TimelineClip[],
  assets: Map<string, SourceAsset>,
): TimelineClip[] {
  const clip = clips.find(c => c.id === clipId);
  if (!clip) return clips;

  const affected = getAffectedIds(clipId, clips);

  return clips.map(c => {
    if (!affected.has(c.id)) return c;
    
    // Clamp: can't trim before the start
    const clamped = Math.max(c.timelineStart + MIN_CLIP_DURATION, newTimelineEnd);
    const asset = assets.get(c.assetId);
    const maxSourceEnd = asset ? asset.duration : Infinity;
    const newSourceEnd = c.sourceStart + (clamped - c.timelineStart);
    
    // Don't let sourceEnd exceed asset duration
    const finalSourceEnd = Math.min(newSourceEnd, maxSourceEnd);
    const finalTimelineEnd = c.timelineStart + (finalSourceEnd - c.sourceStart);
    
    return {
      ...c,
      timelineEnd: finalTimelineEnd,
      sourceEnd: finalSourceEnd,
    };
  });
}

/**
 * Split all clips at the playhead time. Creates new linked groups for the right halves.
 */
export function splitAtPlayhead(
  playheadTime: number,
  clips: TimelineClip[],
  tracks: Track[],
): TimelineClip[] {
  // Find all clips that span the playhead
  const splittable = clips.filter(
    c => playheadTime > c.timelineStart && playheadTime < c.timelineEnd
  );

  if (splittable.length === 0) return clips;

  // Check locked tracks
  const lockedTrackIds = new Set(tracks.filter(t => t.isLocked).map(t => t.id));
  const toSplit = splittable.filter(c => !lockedTrackIds.has(c.trackId));
  if (toSplit.length === 0) return clips;

  // Group by linkedGroupId to create matching new linked groups
  const linkedGroups = new Map<string, string>(); // old linkedGroupId -> new linkedGroupId

  const result: TimelineClip[] = [];
  const splitIds = new Set(toSplit.map(c => c.id));

  for (const clip of clips) {
    if (!splitIds.has(clip.id)) {
      result.push(clip);
      continue;
    }

    const splitOffset = playheadTime - clip.timelineStart;

    // Left half (keeps original ID)
    const left: TimelineClip = {
      ...clip,
      timelineEnd: playheadTime,
      sourceEnd: clip.sourceStart + splitOffset,
    };

    // Determine linkedGroupId for the right half
    let rightLinkedGroupId: string | null = null;
    if (clip.linkedGroupId) {
      if (!linkedGroups.has(clip.linkedGroupId)) {
        linkedGroups.set(clip.linkedGroupId, generateId('link'));
      }
      rightLinkedGroupId = linkedGroups.get(clip.linkedGroupId)!;
    }

    // Right half (new ID, new linked group)
    const right: TimelineClip = {
      ...clip,
      id: generateId('clip'),
      timelineStart: playheadTime,
      sourceStart: clip.sourceStart + splitOffset,
      linkedGroupId: rightLinkedGroupId,
    };

    result.push(left, right);
  }

  return result;
}

/**
 * Delete clips and all their linked partners.
 */
export function deleteClips(
  clipIds: string[],
  clips: TimelineClip[],
  tracks: Track[],
): TimelineClip[] {
  const toRemove = new Set<string>();
  const lockedTrackIds = new Set(tracks.filter(t => t.isLocked).map(t => t.id));

  for (const id of clipIds) {
    const clip = clips.find(c => c.id === id);
    if (!clip || lockedTrackIds.has(clip.trackId)) continue;
    for (const aid of getAffectedIds(id, clips)) {
      const affectedClip = clips.find(c => c.id === aid);
      if (affectedClip && !lockedTrackIds.has(affectedClip.trackId)) {
        toRemove.add(aid);
      }
    }
  }

  return clips.filter(c => !toRemove.has(c.id));
}

/**
 * Unlink clips in a group — sets linkedGroupId to null.
 */
export function unlinkClips(
  linkedGroupId: string,
  clips: TimelineClip[],
): TimelineClip[] {
  return clips.map(c =>
    c.linkedGroupId === linkedGroupId ? { ...c, linkedGroupId: null } : c
  );
}

// ============================================================================
// TRACK OPERATIONS
// ============================================================================

export function addTrack(
  type: 'video' | 'audio',
  tracks: Track[],
): Track {
  const sameType = tracks.filter(t => t.type === type);
  const maxOrder = tracks.reduce((max, t) => Math.max(max, t.order), 0);
  return {
    id: generateId(type === 'video' ? 'vtrack' : 'atrack'),
    name: `${type === 'video' ? 'Video' : 'Audio'} ${sameType.length + 1}`,
    type,
    order: maxOrder + 1,
    isMuted: false,
    isSolo: false,
    isLocked: false,
  };
}

export function removeTrack(
  trackId: string,
  tracks: Track[],
  clips: TimelineClip[],
): { tracks: Track[]; clips: TimelineClip[] } | null {
  const track = tracks.find(t => t.id === trackId);
  if (!track) return null;

  const sameType = tracks.filter(t => t.type === track.type);
  if (sameType.length <= 1) return null; // can't remove last of its type

  return {
    tracks: tracks.filter(t => t.id !== trackId),
    clips: clips.filter(c => c.trackId !== trackId),
  };
}

export function toggleTrackMute(trackId: string, tracks: Track[]): Track[] {
  return tracks.map(t => t.id === trackId ? { ...t, isMuted: !t.isMuted } : t);
}

export function toggleTrackSolo(trackId: string, tracks: Track[]): Track[] {
  const track = tracks.find(t => t.id === trackId);
  if (!track) return tracks;

  if (!track.isSolo) {
    // Solo on: solo this track, un-solo others of same type
    return tracks.map(t => ({
      ...t,
      isSolo: t.id === trackId,
      isMuted: t.type === track.type && t.id !== trackId ? true : t.isMuted,
    }));
  } else {
    // Solo off: un-solo and un-mute all of same type
    return tracks.map(t => ({
      ...t,
      isSolo: t.id === trackId ? false : t.isSolo,
      isMuted: t.type === track.type ? false : t.isMuted,
    }));
  }
}

export function toggleTrackLock(trackId: string, tracks: Track[]): Track[] {
  return tracks.map(t => t.id === trackId ? { ...t, isLocked: !t.isLocked } : t);
}
