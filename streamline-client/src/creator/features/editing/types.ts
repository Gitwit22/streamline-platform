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
  volume: number; // 0-1, default 1
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

// ============================================================================
// HELPERS
// ============================================================================

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
