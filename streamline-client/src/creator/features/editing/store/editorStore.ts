// ============================================================================
// EDITOR STORE — Centralized Zustand store for the entire editing system
// Single source of truth for project, assets, timeline, playback, and UI state
// ============================================================================

import { create } from 'zustand';
import type { SourceAsset, TimelineClip, Track, DragState, HistoryEntry } from '../types';
import { MAX_UNDO_HISTORY, generateId } from '../types';
import { computeTotalDuration } from '../engine/playbackResolver';
import {
  placeAssetOnTimeline,
  moveClips as moveClipsOp,
  trimClipStart as trimClipStartOp,
  trimClipEnd as trimClipEndOp,
  splitAtPlayhead as splitOp,
  deleteClips as deleteClipsOp,
  unlinkClips as unlinkClipsOp,
  addTrack as addTrackOp,
  removeTrack as removeTrackOp,
  toggleTrackMute as toggleTrackMuteOp,
  toggleTrackSolo as toggleTrackSoloOp,
  toggleTrackLock as toggleTrackLockOp,
} from '../engine/operations';
import { startPlaybackClock, stopPlaybackClock } from '../engine/playbackClock';

// ============================================================================
// STORE TYPE
// ============================================================================

export interface EditorStore {
  // --- Project ---
  projectId: string | null;
  projectName: string;
  isDirty: boolean;
  saveStatus: 'idle' | 'saving' | 'saved' | 'error';

  // --- Assets ---
  assets: Map<string, SourceAsset>;

  // --- Timeline ---
  tracks: Track[];
  clips: TimelineClip[];

  // --- Playback ---
  playheadTime: number;
  isPlaying: boolean;

  // --- Selection ---
  selectedClipIds: Set<string>;
  hoveredClipId: string | null;

  // --- UI ---
  zoom: number;
  scrollLeft: number;
  snapEnabled: boolean;
  dragState: DragState | null;
  snapLineX: number | null;

  // --- History ---
  undoStack: HistoryEntry[];
  redoStack: HistoryEntry[];

  // --- Computed (derived but stored for perf) ---
  totalDuration: number;

  // --- Actions: Project ---
  setProjectId: (id: string | null) => void;
  setProjectName: (name: string) => void;
  setSaveStatus: (status: EditorStore['saveStatus']) => void;
  markDirty: () => void;

  // --- Actions: Assets ---
  addAsset: (asset: SourceAsset) => void;
  removeAsset: (id: string) => void;
  getAsset: (id: string) => SourceAsset | undefined;

  // --- Actions: Timeline mutations (all push undo) ---
  placeAsset: (asset: SourceAsset, time: number) => void;
  moveClips: (clipIds: string[], timeDelta: number) => void;
  trimStart: (clipId: string, newTimelineStart: number) => void;
  trimEnd: (clipId: string, newTimelineEnd: number) => void;
  splitAtPlayhead: () => void;
  deleteSelectedClips: () => void;
  deleteClipsByIds: (clipIds: string[]) => void;
  unlinkClips: (linkedGroupId: string) => void;
  setClipVolume: (clipId: string, volume: number) => void;
  setClipMuted: (clipId: string, muted: boolean) => void;

  // --- Actions: Tracks ---
  addTrack: (type: 'video' | 'audio') => void;
  removeTrack: (trackId: string) => void;
  toggleMute: (trackId: string) => void;
  toggleSolo: (trackId: string) => void;
  toggleLock: (trackId: string) => void;

  // --- Actions: Playback ---
  play: () => void;
  pause: () => void;
  togglePlayPause: () => void;
  seek: (time: number) => void;
  seekRelative: (delta: number) => void;
  setPlayheadTime: (time: number) => void;

  // --- Actions: Selection ---
  selectClip: (clipId: string) => void;
  toggleClipSelection: (clipId: string) => void;
  selectAllClips: () => void;
  clearSelection: () => void;
  setHoveredClip: (clipId: string | null) => void;

  // --- Actions: UI ---
  setZoom: (zoom: number) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  setScrollLeft: (scrollLeft: number) => void;
  setSnapEnabled: (enabled: boolean) => void;
  setDragState: (state: DragState | null) => void;
  setSnapLineX: (x: number | null) => void;

  // --- Actions: History ---
  pushUndoSnapshot: (description: string) => void;
  undo: () => void;
  redo: () => void;

  // --- Actions: Hydration ---
  hydrateProject: (data: {
    projectId: string | null;
    projectName: string;
    tracks: Track[];
    clips: TimelineClip[];
    assets: Map<string, SourceAsset>;
  }) => void;
  resetEditor: () => void;
}

// ============================================================================
// DEFAULT STATE
// ============================================================================

function defaultTracks(): Track[] {
  return [
    { id: 'video_1', name: 'Video 1', type: 'video', order: 0, isMuted: false, isSolo: false, isLocked: false },
    { id: 'audio_1', name: 'Audio 1', type: 'audio', order: 1, isMuted: false, isSolo: false, isLocked: false },
  ];
}

// ============================================================================
// STORE IMPLEMENTATION
// ============================================================================

export const useEditorStore = create<EditorStore>((set, get) => ({
  // --- Initial state ---
  projectId: null,
  projectName: 'Untitled Project',
  isDirty: false,
  saveStatus: 'idle',

  assets: new Map(),

  tracks: defaultTracks(),
  clips: [],

  playheadTime: 0,
  isPlaying: false,

  selectedClipIds: new Set(),
  hoveredClipId: null,

  zoom: 1,
  scrollLeft: 0,
  snapEnabled: true,
  dragState: null,
  snapLineX: null,

  undoStack: [],
  redoStack: [],

  totalDuration: 0,

  // ===== PROJECT ACTIONS =====

  setProjectId: (id) => set({ projectId: id }),
  setProjectName: (name) => set({ projectName: name, isDirty: true }),
  setSaveStatus: (status) => set({ saveStatus: status }),
  markDirty: () => set({ isDirty: true }),

  // ===== ASSET ACTIONS =====

  addAsset: (asset) => set(s => {
    const next = new Map(s.assets);
    next.set(asset.id, asset);
    return { assets: next };
  }),

  removeAsset: (id) => set(s => {
    const next = new Map(s.assets);
    next.delete(id);
    return { assets: next };
  }),

  getAsset: (id) => get().assets.get(id),

  // ===== TIMELINE MUTATION ACTIONS =====

  placeAsset: (asset, time) => {
    const s = get();
    s.pushUndoSnapshot('Place asset');
    const { newClips } = placeAssetOnTimeline(asset, time, s.tracks, s.clips);
    const allClips = [...s.clips, ...newClips];
    set({
      clips: allClips,
      totalDuration: computeTotalDuration(allClips),
      isDirty: true,
    });
  },

  moveClips: (clipIds, timeDelta) => {
    const s = get();
    const newClips = moveClipsOp(clipIds, timeDelta, s.clips);
    set({
      clips: newClips,
      totalDuration: computeTotalDuration(newClips),
      isDirty: true,
    });
  },

  trimStart: (clipId, newTimelineStart) => {
    const s = get();
    const newClips = trimClipStartOp(clipId, newTimelineStart, s.clips, s.assets);
    set({
      clips: newClips,
      totalDuration: computeTotalDuration(newClips),
      isDirty: true,
    });
  },

  trimEnd: (clipId, newTimelineEnd) => {
    const s = get();
    const newClips = trimClipEndOp(clipId, newTimelineEnd, s.clips, s.assets);
    set({
      clips: newClips,
      totalDuration: computeTotalDuration(newClips),
      isDirty: true,
    });
  },

  splitAtPlayhead: () => {
    const s = get();
    s.pushUndoSnapshot('Split at playhead');
    const newClips = splitOp(s.playheadTime, s.clips, s.tracks);
    set({
      clips: newClips,
      totalDuration: computeTotalDuration(newClips),
      isDirty: true,
    });
  },

  deleteSelectedClips: () => {
    const s = get();
    if (s.selectedClipIds.size === 0) return;
    s.pushUndoSnapshot('Delete clips');
    const newClips = deleteClipsOp([...s.selectedClipIds], s.clips, s.tracks);
    set({
      clips: newClips,
      totalDuration: computeTotalDuration(newClips),
      selectedClipIds: new Set(),
      isDirty: true,
    });
  },

  deleteClipsByIds: (clipIds) => {
    const s = get();
    s.pushUndoSnapshot('Delete clips');
    const newClips = deleteClipsOp(clipIds, s.clips, s.tracks);
    set({
      clips: newClips,
      totalDuration: computeTotalDuration(newClips),
      selectedClipIds: new Set(),
      isDirty: true,
    });
  },

  unlinkClips: (linkedGroupId) => {
    const s = get();
    s.pushUndoSnapshot('Unlink clips');
    set({ clips: unlinkClipsOp(linkedGroupId, s.clips), isDirty: true });
  },

  setClipVolume: (clipId, volume) => set(s => ({
    clips: s.clips.map(c => c.id === clipId ? { ...c, volume: Math.max(0, Math.min(1, volume)) } : c),
    isDirty: true,
  })),

  setClipMuted: (clipId, muted) => set(s => ({
    clips: s.clips.map(c => c.id === clipId ? { ...c, isMuted: muted } : c),
    isDirty: true,
  })),

  // ===== TRACK ACTIONS =====

  addTrack: (type) => {
    const s = get();
    s.pushUndoSnapshot('Add track');
    const newTrack = addTrackOp(type, s.tracks);
    set({ tracks: [...s.tracks, newTrack], isDirty: true });
  },

  removeTrack: (trackId) => {
    const s = get();
    const result = removeTrackOp(trackId, s.tracks, s.clips);
    if (!result) return;
    s.pushUndoSnapshot('Remove track');
    set({
      tracks: result.tracks,
      clips: result.clips,
      totalDuration: computeTotalDuration(result.clips),
      isDirty: true,
    });
  },

  toggleMute: (trackId) => set(s => ({ tracks: toggleTrackMuteOp(trackId, s.tracks) })),
  toggleSolo: (trackId) => set(s => ({ tracks: toggleTrackSoloOp(trackId, s.tracks) })),
  toggleLock: (trackId) => set(s => ({ tracks: toggleTrackLockOp(trackId, s.tracks) })),

  // ===== PLAYBACK ACTIONS =====

  play: () => {
    const s = get();
    if (s.isPlaying) return;
    if (s.totalDuration === 0) return;
    // If at end, wrap to start
    if (s.playheadTime >= s.totalDuration) {
      set({ playheadTime: 0 });
    }
    set({ isPlaying: true });
    startPlaybackClock({
      getPlayheadTime: () => get().playheadTime,
      getTotalDuration: () => get().totalDuration,
      setPlayheadTime: (t) => set({ playheadTime: t }),
      setIsPlaying: (p) => {
        if (!p) stopPlaybackClock();
        set({ isPlaying: p });
      },
    });
  },

  pause: () => {
    stopPlaybackClock();
    set({ isPlaying: false });
  },

  togglePlayPause: () => {
    const s = get();
    if (s.isPlaying) {
      s.pause();
    } else {
      s.play();
    }
  },

  seek: (time) => {
    const s = get();
    const clamped = Math.max(0, Math.min(time, s.totalDuration || 0));
    set({ playheadTime: clamped });
  },

  seekRelative: (delta) => {
    const s = get();
    s.seek(s.playheadTime + delta);
  },

  setPlayheadTime: (time) => set({ playheadTime: time }),

  // ===== SELECTION ACTIONS =====

  selectClip: (clipId) => set({ selectedClipIds: new Set([clipId]) }),

  toggleClipSelection: (clipId) => set(s => {
    const next = new Set(s.selectedClipIds);
    if (next.has(clipId)) {
      next.delete(clipId);
    } else {
      next.add(clipId);
    }
    return { selectedClipIds: next };
  }),

  selectAllClips: () => set(s => ({
    selectedClipIds: new Set(s.clips.map(c => c.id)),
  })),

  clearSelection: () => set({ selectedClipIds: new Set() }),

  setHoveredClip: (clipId) => set({ hoveredClipId: clipId }),

  // ===== UI ACTIONS =====

  setZoom: (zoom) => set({ zoom: Math.max(0.25, Math.min(4, zoom)) }),
  zoomIn: () => set(s => ({ zoom: Math.min(4, s.zoom + 0.25) })),
  zoomOut: () => set(s => ({ zoom: Math.max(0.25, s.zoom - 0.25) })),
  setScrollLeft: (scrollLeft) => set({ scrollLeft }),
  setSnapEnabled: (enabled) => set({ snapEnabled: enabled }),
  setDragState: (state) => set({ dragState: state }),
  setSnapLineX: (x) => set({ snapLineX: x }),

  // ===== HISTORY ACTIONS =====

  pushUndoSnapshot: (description) => set(s => ({
    undoStack: [
      ...s.undoStack.slice(-(MAX_UNDO_HISTORY - 1)),
      { clips: structuredClone(s.clips), tracks: structuredClone(s.tracks), description },
    ],
    redoStack: [],
  })),

  undo: () => {
    const s = get();
    if (s.undoStack.length === 0) return;
    const prev = s.undoStack[s.undoStack.length - 1];
    set({
      undoStack: s.undoStack.slice(0, -1),
      redoStack: [
        ...s.redoStack,
        { clips: structuredClone(s.clips), tracks: structuredClone(s.tracks), description: 'undo' },
      ],
      clips: prev.clips,
      tracks: prev.tracks,
      totalDuration: computeTotalDuration(prev.clips),
      isDirty: true,
    });
  },

  redo: () => {
    const s = get();
    if (s.redoStack.length === 0) return;
    const next = s.redoStack[s.redoStack.length - 1];
    set({
      redoStack: s.redoStack.slice(0, -1),
      undoStack: [
        ...s.undoStack,
        { clips: structuredClone(s.clips), tracks: structuredClone(s.tracks), description: 'redo' },
      ],
      clips: next.clips,
      tracks: next.tracks,
      totalDuration: computeTotalDuration(next.clips),
      isDirty: true,
    });
  },

  // ===== HYDRATION =====

  hydrateProject: (data) => {
    stopPlaybackClock();
    set({
      projectId: data.projectId,
      projectName: data.projectName,
      tracks: data.tracks,
      clips: data.clips,
      assets: data.assets,
      totalDuration: computeTotalDuration(data.clips),
      playheadTime: 0,
      isPlaying: false,
      selectedClipIds: new Set(),
      hoveredClipId: null,
      undoStack: [],
      redoStack: [],
      isDirty: false,
      saveStatus: 'idle',
      dragState: null,
      snapLineX: null,
    });
  },

  resetEditor: () => {
    stopPlaybackClock();
    set({
      projectId: null,
      projectName: 'Untitled Project',
      isDirty: false,
      saveStatus: 'idle',
      assets: new Map(),
      tracks: defaultTracks(),
      clips: [],
      playheadTime: 0,
      isPlaying: false,
      selectedClipIds: new Set(),
      hoveredClipId: null,
      zoom: 1,
      scrollLeft: 0,
      snapEnabled: true,
      dragState: null,
      snapLineX: null,
      undoStack: [],
      redoStack: [],
      totalDuration: 0,
    });
  },
}));
