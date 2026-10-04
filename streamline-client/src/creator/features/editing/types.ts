// ============================================================================
// EDITOR TYPES — Single source of truth for the editing system
// ============================================================================

/** A reusable media source imported into the project */
export interface SourceAsset {
  id: string;
  type: 'video' | 'audio' | 'image';
  url: string;
  fileName: string;
  duration: number; // seconds
  hasVideo: boolean;
  hasAudio: boolean;
  width?: number;
  height?: number;
  waveformUrl?: string;
  thumbnailUrl?: string;
  metadata?: Record<string, unknown>;
}

/** A placed clip on the timeline referencing a SourceAsset */
export interface TimelineClip {
  id: string;
  assetId: string;
  trackId: string;
  type: 'video' | 'audio';
  timelineStart: number; // seconds — position on timeline
  timelineEnd: number;   // seconds
  sourceStart: number;   // seconds — trim in
  sourceEnd: number;     // seconds — trim out
  linkedGroupId: string | null;
  isMuted: boolean;
  isHidden: boolean;
  displayName: string;
  /** Linear gain 0..MAX_CLIP_VOLUME (1 = unity). Exported audio applies it. */
  volume: number;
  /** Video clips only: embedded audio split off (unlinked from its audio clip). */
  audioDetached?: boolean;
}

/** A lane on the timeline */
export interface Track {
  id: string;
  name: string;
  type: 'video' | 'audio';
  order: number;
  isMuted: boolean;
  isSolo: boolean;
  isLocked: boolean;
}

/** Resolved playback state at a given time */
export interface PlaybackState {
  activeVideoClip: TimelineClip | null;
  /** The active video clip's own audio is audible (no linked audio clip). */
  videoPlaysEmbeddedAudio: boolean;
  activeAudioClips: TimelineClip[];
  videoSourceTime: number | null;
  audioSourceTimes: Map<string, number>; // clipId -> sourceTime
  isBlack: boolean;
}

/** Undo/redo snapshot */
export interface HistoryEntry {
  clips: TimelineClip[];
  tracks: Track[];
  description: string;
}

/** Drag interaction state */
export interface DragState {
  clipId: string;
  mode: 'move' | 'trim-start' | 'trim-end';
  startX: number;
  currentX: number;
}

// ============================================================================
// CONSTANTS
// ============================================================================

export const PIXELS_PER_SECOND = 12;
export const TIMELINE_LEFT_GUTTER_PX = 128;
export const RULER_HEIGHT = 32;
export const TRACK_HEIGHT = 80;
export const MIN_CLIP_DURATION = 0.033; // ~1 frame at 30fps
export const MAX_UNDO_HISTORY = 50;
export const SNAP_THRESHOLD_PX = 6;
export const MAX_SIMULTANEOUS_AUDIO = 4;
/** Per-clip gain ceiling (2 = +6 dB); matches the server render. */
export const MAX_CLIP_VOLUME = 2;

// ============================================================================
// HELPERS
// ============================================================================

export function clampVolume(v: number): number {
  if (!Number.isFinite(v)) return 1;
  return Math.max(0, Math.min(MAX_CLIP_VOLUME, v));
}

/**
 * A video clip plays its embedded audio only when that audio is not already a
 * linked audio clip (the editor places linked video+audio pairs) and has not
 * been detached. Mirrors server lib/editorTimeline.ts.
 */
export function videoClipPlaysEmbeddedAudio(clip: TimelineClip, clips: TimelineClip[]): boolean {
  if (clip.type !== 'video' || clip.audioDetached) return false;
  if (!clip.linkedGroupId) return true;
  return !clips.some(c => c.type === 'audio' && c.linkedGroupId === clip.linkedGroupId && c.id !== clip.id);
}

export function clipDuration(clip: TimelineClip): number {
  return clip.timelineEnd - clip.timelineStart;
}

export function formatTimecode(seconds: number): string {
  const mins = Math.floor(Math.abs(seconds) / 60);
  const secs = Math.floor(Math.abs(seconds) % 60);
  const frames = Math.floor((Math.abs(seconds) % 1) * 30);
  return `${mins}:${secs.toString().padStart(2, '0')}:${frames.toString().padStart(2, '0')}`;
}

export function generateId(prefix = 'id'): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
