// ============================================================================
// PLAYBACK RESOLVER — Maps timeline time to active clips and source offsets
// Pure function: no side effects, no state mutation
// ============================================================================

import type { TimelineClip, Track, PlaybackState } from '../types';
import { MAX_SIMULTANEOUS_AUDIO } from '../types';

/**
 * Given a playhead time, determine which clips are active and their source offsets.
 * This is the SINGLE SOURCE OF TRUTH for what the preview shows.
 */
export function resolvePlayback(
  time: number,
  clips: TimelineClip[],
  tracks: Track[],
): PlaybackState {
  // Build a set of effective muted track IDs (respecting solo)
  const mutedTrackIds = new Set<string>();
  const soloTracks = tracks.filter(t => t.isSolo);
  
  if (soloTracks.length > 0) {
    // When any track is soloed, mute all non-soloed tracks
    for (const t of tracks) {
      if (!t.isSolo) mutedTrackIds.add(t.id);
    }
  } else {
    for (const t of tracks) {
      if (t.isMuted) mutedTrackIds.add(t.id);
    }
  }

  // Find all clips at the given time
  const activeClips = clips.filter(
    c => c.timelineStart <= time && time < c.timelineEnd && !c.isHidden
  );

  // Sort video tracks by order (lowest order = topmost = highest priority)
  const videoTracks = tracks
    .filter(t => t.type === 'video')
    .sort((a, b) => a.order - b.order);

  // Find the active video clip (topmost visible video track)
  let activeVideoClip: TimelineClip | null = null;
  let videoSourceTime: number | null = null;

  for (const vt of videoTracks) {
    if (mutedTrackIds.has(vt.id)) continue;
    const clip = activeClips.find(c => c.trackId === vt.id && c.type === 'video' && !c.isMuted);
    if (clip) {
      activeVideoClip = clip;
      videoSourceTime = clip.sourceStart + (time - clip.timelineStart);
      break;
    }
  }

  // Find all active audio clips (up to MAX_SIMULTANEOUS_AUDIO)
  const audioSourceTimes = new Map<string, number>();
  const activeAudioClips: TimelineClip[] = [];

  // Sort audio tracks by order
  const audioTracks = tracks
    .filter(t => t.type === 'audio')
    .sort((a, b) => a.order - b.order);

  for (const at of audioTracks) {
    if (mutedTrackIds.has(at.id)) continue;
    const trackClips = activeClips.filter(
      c => c.trackId === at.id && c.type === 'audio' && !c.isMuted
    );
    for (const clip of trackClips) {
      if (activeAudioClips.length >= MAX_SIMULTANEOUS_AUDIO) break;
      const sourceTime = clip.sourceStart + (time - clip.timelineStart);
      activeAudioClips.push(clip);
      audioSourceTimes.set(clip.id, sourceTime);
    }
    if (activeAudioClips.length >= MAX_SIMULTANEOUS_AUDIO) break;
  }

  // Also include audio from the active video clip's linked group if applicable
  if (activeVideoClip?.linkedGroupId) {
    const linkedAudio = activeClips.find(
      c => c.linkedGroupId === activeVideoClip!.linkedGroupId &&
           c.type === 'audio' &&
           !c.isMuted &&
           !mutedTrackIds.has(c.trackId) &&
           !activeAudioClips.some(ac => ac.id === c.id)
    );
    if (linkedAudio && activeAudioClips.length < MAX_SIMULTANEOUS_AUDIO) {
      const sourceTime = linkedAudio.sourceStart + (time - linkedAudio.timelineStart);
      activeAudioClips.push(linkedAudio);
      audioSourceTimes.set(linkedAudio.id, sourceTime);
    }
  }

  return {
    activeVideoClip,
    activeAudioClips,
    videoSourceTime,
    audioSourceTimes,
    isBlack: activeVideoClip === null,
  };
}

/**
 * Compute total timeline duration from clips
 */
export function computeTotalDuration(clips: TimelineClip[]): number {
  if (clips.length === 0) return 0;
  return clips.reduce((max, c) => Math.max(max, c.timelineEnd), 0);
}
