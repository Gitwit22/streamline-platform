/**
 * Editor timeline — canonical project timeline model (pure, no Firestore).
 *
 * Stored on `projects/{id}.timeline` (version 2). Times are seconds, matching
 * the client editor store, so the editor saves and loads without conversion.
 * Clips reference MediaAssets by id only (recordings / editing_assets /
 * saved_videos / project_assets); playable URLs are resolved server-side, so
 * no client-supplied URL is ever persisted or downloaded by the renderer.
 *
 * Also holds the converters from the two legacy timeline shapes:
 *   - editing_projects.timeline  { clips: [{startTime, duration, inPoint,
 *     outPoint, trackId, assetId, videoUrl}], tracks: number | [...] }
 *   - Layer 3 timeline_clips (ms) + editing_project_assets -> saved_videos
 * and the builder from the canonical timeline to the render worker contract.
 */
import type { ClipTransition, ExportTimeline, ExportTimelineClip, ExportTimelineTrack, TransitionType } from "./exportTypes";

export const EDITOR_TIMELINE_VERSION = 2;
export const MAX_TIMELINE_CLIPS = 500;
export const MAX_TIMELINE_TRACKS = 20;
/** Per-clip gain range (0 = silent, 1 = unity, 2 = +6 dB). */
export const MAX_CLIP_VOLUME = 2;

export type TrackType = "video" | "audio";

export interface EditorTrack {
  id: string;
  name: string;
  type: TrackType;
  order: number;
  isMuted: boolean;
  isSolo: boolean;
  isLocked: boolean;
}

export interface EditorClip {
  id: string;
  assetId: string;
  trackId: string;
  type: TrackType;
  timelineStart: number;
  timelineEnd: number;
  sourceStart: number;
  sourceEnd: number;
  linkedGroupId: string | null;
  isMuted: boolean;
  isHidden: boolean;
  displayName: string;
  volume: number;
  /** Video clips only: the clip's own (embedded) audio was split off. */
  audioDetached?: boolean;
  /** Video clips only: how the clip enters (fade / dip to black / crossfade). */
  transitionIn?: ClipTransition;
}

export const TRANSITION_TYPES: readonly TransitionType[] = ["fade", "dip_to_black", "crossfade"];
export const TRANSITION_MIN_MS = 100;
export const TRANSITION_MAX_MS = 3000;

/** Validate a stored / client transition; null when absent or invalid. */
export function normalizeTransition(raw: any): ClipTransition | null {
  if (!raw || typeof raw !== "object" || !TRANSITION_TYPES.includes(raw.type)) return null;
  const ms = num(raw.durationMs, 1000);
  return { type: raw.type, durationMs: Math.round(Math.max(TRANSITION_MIN_MS, Math.min(TRANSITION_MAX_MS, ms))) };
}

export interface EditorTimeline {
  version: typeof EDITOR_TIMELINE_VERSION;
  tracks: EditorTrack[];
  clips: EditorClip[];
}

export function defaultEditorTracks(): EditorTrack[] {
  return [
    { id: "video_1", name: "Video 1", type: "video", order: 0, isMuted: false, isSolo: false, isLocked: false },
    { id: "audio_1", name: "Audio 1", type: "audio", order: 1, isMuted: false, isSolo: false, isLocked: false },
  ];
}

function num(v: unknown, fallback = 0): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function str(v: unknown, max: number, fallback = ""): string {
  return typeof v === "string" ? v.slice(0, max) : fallback;
}

/** Clamp a clip gain to [0, MAX_CLIP_VOLUME]; missing / invalid -> 1. */
export function clampVolume(v: unknown): number {
  if (v === undefined || v === null || v === "") return 1;
  const n = num(v, 1);
  return Math.max(0, Math.min(MAX_CLIP_VOLUME, n));
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

// ============================================================================
// Validation (PUT /api/projects/:id/timeline)
// ============================================================================

export type SanitizeResult = { ok: true; timeline: EditorTimeline } | { ok: false; error: string };

export function sanitizeEditorTimeline(raw: any): SanitizeResult {
  if (!raw || typeof raw !== "object") return { ok: false, error: "timeline_required" };
  const rawClips = raw.clips;
  const rawTracks = raw.tracks;
  if (!Array.isArray(rawClips)) return { ok: false, error: "clips_must_be_array" };
  if (rawClips.length > MAX_TIMELINE_CLIPS) return { ok: false, error: "too_many_clips" };
  if (rawTracks !== undefined && !Array.isArray(rawTracks)) return { ok: false, error: "tracks_must_be_array" };
  if (Array.isArray(rawTracks) && rawTracks.length > MAX_TIMELINE_TRACKS) return { ok: false, error: "too_many_tracks" };

  const tracks: EditorTrack[] = [];
  const seenTracks = new Set<string>();
  for (const [idx, t] of (Array.isArray(rawTracks) ? rawTracks : []).entries()) {
    const id = str(t?.id, 100).trim();
    if (!id || seenTracks.has(id)) continue;
    seenTracks.add(id);
    tracks.push({
      id,
      name: str(t?.name, 100, "Track") || "Track",
      type: t?.type === "audio" ? "audio" : "video",
      order: Number.isFinite(Number(t?.order)) ? Math.round(Number(t.order)) : idx,
      isMuted: t?.isMuted === true,
      isSolo: t?.isSolo === true,
      isLocked: t?.isLocked === true,
    });
  }
  const finalTracks = tracks.length > 0 ? tracks : defaultEditorTracks();
  const trackById = new Map(finalTracks.map((t) => [t.id, t]));

  const clips: EditorClip[] = [];
  const seenClips = new Set<string>();
  for (const c of rawClips) {
    const id = str(c?.id, 120).trim();
    const assetId = str(c?.assetId, 200).trim();
    const trackId = str(c?.trackId, 100).trim();
    if (!id || !assetId || seenClips.has(id)) continue;
    const track = trackById.get(trackId);
    if (!track) return { ok: false, error: "clip_track_unknown" };
    seenClips.add(id);
    const timelineStart = Math.max(0, num(c?.timelineStart));
    const timelineEnd = Math.max(timelineStart, num(c?.timelineEnd));
    const sourceStart = Math.max(0, num(c?.sourceStart));
    const sourceEnd = Math.max(sourceStart, num(c?.sourceEnd, sourceStart + (timelineEnd - timelineStart)));
    if (timelineEnd - timelineStart <= 0) continue;
    const type: TrackType = c?.type === "audio" || c?.type === "video" ? c.type : track.type;
    clips.push({
      id,
      assetId,
      trackId,
      type,
      timelineStart: round3(timelineStart),
      timelineEnd: round3(timelineEnd),
      sourceStart: round3(sourceStart),
      sourceEnd: round3(sourceEnd),
      linkedGroupId: typeof c?.linkedGroupId === "string" && c.linkedGroupId ? c.linkedGroupId.slice(0, 120) : null,
      isMuted: c?.isMuted === true,
      isHidden: c?.isHidden === true,
      displayName: str(c?.displayName, 200),
      volume: clampVolume(c?.volume),
      ...(type === "video" && c?.audioDetached === true ? { audioDetached: true } : {}),
      ...(() => {
        const tr = type === "video" ? normalizeTransition(c?.transitionIn) : null;
        return tr ? { transitionIn: tr } : {};
      })(),
    });
  }

  return { ok: true, timeline: { version: EDITOR_TIMELINE_VERSION, tracks: finalTracks, clips } };
}

export function isEditorTimeline(v: any): v is EditorTimeline {
  return !!v && typeof v === "object" && v.version === EDITOR_TIMELINE_VERSION && Array.isArray(v.clips) && Array.isArray(v.tracks);
}

export function timelineDurationSec(t: EditorTimeline | null | undefined): number {
  if (!t) return 0;
  return t.clips.reduce((max, c) => Math.max(max, c.timelineEnd), 0);
}

// ============================================================================
// Legacy conversions
// ============================================================================

/**
 * editing_projects.timeline -> canonical. Legacy saves dropped the A/V link,
 * volume and mute flags; video/audio clips of the same asset placed at the
 * same time with the same source range are re-linked so the video clip does
 * not also contribute its embedded audio (which would double the sound).
 * Unpaired video clips keep their embedded audio (old bridge-created clips).
 */
export function legacyTimelineToEditor(legacy: any): EditorTimeline {
  const rawTracks = Array.isArray(legacy?.tracks) ? legacy.tracks : [];
  const tracks: EditorTrack[] = rawTracks.length
    ? rawTracks
        .filter((t: any) => t && typeof t.id === "string")
        .map((t: any, idx: number) => ({
          id: String(t.id).slice(0, 100),
          name: str(t.name, 100, "Track") || "Track",
          type: t.type === "audio" ? ("audio" as const) : ("video" as const),
          order: idx,
          isMuted: t.muted === true || t.isMuted === true,
          isSolo: t.solo === true || t.isSolo === true,
          isLocked: t.locked === true || t.isLocked === true,
        }))
    : defaultEditorTracks();
  const trackIds = new Set(tracks.map((t) => t.id));

  const rawClips = Array.isArray(legacy?.clips) ? legacy.clips : [];
  const clips: EditorClip[] = [];
  for (const c of rawClips) {
    const id = str(c?.id, 120);
    const assetId = str(c?.assetId, 200);
    if (!id || !assetId) continue;
    let trackId = typeof c?.trackId === "string" && c.trackId ? c.trackId : "video_1";
    const type: TrackType = trackId.startsWith("audio") ? "audio" : "video";
    if (!trackIds.has(trackId)) {
      const fallback = tracks.find((t) => t.type === type);
      if (!fallback) continue;
      trackId = fallback.id;
    }
    const start = Math.max(0, num(c?.startTime));
    const duration = Math.max(0, num(c?.duration));
    const inPoint = Math.max(0, num(c?.inPoint));
    const outPointRaw = num(c?.outPoint);
    const outPoint = outPointRaw > inPoint ? outPointRaw : inPoint + duration;
    if (duration <= 0) continue;
    clips.push({
      id,
      assetId,
      trackId,
      type,
      timelineStart: round3(start),
      timelineEnd: round3(start + duration),
      sourceStart: round3(inPoint),
      sourceEnd: round3(outPoint),
      linkedGroupId: null,
      isMuted: c?.isMuted === true,
      isHidden: false,
      displayName: str(c?.name, 200),
      volume: clampVolume(c?.volume),
    });
  }

  relinkPairs(clips);
  return { version: EDITOR_TIMELINE_VERSION, tracks, clips };
}

/** Link video/audio clips of the same asset that share placement + range. */
function relinkPairs(clips: EditorClip[]): void {
  const key = (c: EditorClip) => `${c.assetId}|${c.timelineStart}|${c.timelineEnd}|${c.sourceStart}|${c.sourceEnd}`;
  const audioByKey = new Map<string, EditorClip[]>();
  for (const c of clips) {
    if (c.type !== "audio" || c.linkedGroupId) continue;
    const list = audioByKey.get(key(c)) || [];
    list.push(c);
    audioByKey.set(key(c), list);
  }
  for (const v of clips) {
    if (v.type !== "video" || v.linkedGroupId) continue;
    const partner = audioByKey.get(key(v))?.shift();
    if (!partner) continue;
    const group = `link_${v.id}`;
    v.linkedGroupId = group;
    partner.linkedGroupId = group;
  }
}

/**
 * Layer 3 timeline_clips (ms) -> canonical. projectAssets maps
 * editing_project_assets id -> savedVideoId; clips reference the saved video
 * (a MediaAsset) directly.
 */
export function layeredClipsToEditor(
  timelineClips: Array<Record<string, any>>,
  projectAssetToSavedVideo: Map<string, string>,
  names: Map<string, string> = new Map(),
): EditorTimeline {
  const tracks = defaultEditorTracks();
  const clips: EditorClip[] = [];
  for (const tc of timelineClips) {
    const savedVideoId = projectAssetToSavedVideo.get(String(tc.projectAssetId || ""));
    if (!savedVideoId) continue;
    const startMs = Math.max(0, num(tc.startMs));
    const endMs = Math.max(startMs, num(tc.endMs));
    if (endMs <= startMs) continue;
    const trimIn = Math.max(0, num(tc.trimInMs));
    const trimOutRaw = num(tc.trimOutMs);
    const trimOut = trimOutRaw > trimIn ? trimOutRaw : trimIn + (endMs - startMs);
    const type: TrackType = tc.kind === "audio" ? "audio" : "video";
    clips.push({
      id: String(tc.id),
      assetId: savedVideoId,
      trackId: type === "audio" ? "audio_1" : "video_1",
      type,
      timelineStart: round3(startMs / 1000),
      timelineEnd: round3(endMs / 1000),
      sourceStart: round3(trimIn / 1000),
      sourceEnd: round3(trimOut / 1000),
      linkedGroupId: typeof tc.linkGroupId === "string" && tc.linkGroupId ? tc.linkGroupId : null,
      isMuted: false,
      isHidden: false,
      displayName: names.get(savedVideoId) || (type === "audio" ? "Audio" : "Video"),
      volume: 1,
    });
  }
  return { version: EDITOR_TIMELINE_VERSION, tracks, clips };
}

// ============================================================================
// Mixing rules (shared with the client preview)
// ============================================================================

/** Tracks that are silent/hidden: any solo -> every non-solo track, else muted tracks. */
export function effectiveMutedTrackIds(tracks: EditorTrack[]): Set<string> {
  const out = new Set<string>();
  const anySolo = tracks.some((t) => t.isSolo);
  for (const t of tracks) {
    if (anySolo ? !t.isSolo : t.isMuted) out.add(t.id);
  }
  return out;
}

/**
 * A video clip plays its embedded audio only when that audio is not already
 * represented by a linked audio clip (the editor places linked video+audio
 * pairs; the audio clip carries volume/mute) and has not been detached.
 */
export function videoClipPlaysEmbeddedAudio(clip: EditorClip, clips: EditorClip[]): boolean {
  if (clip.type !== "video" || clip.audioDetached) return false;
  if (!clip.linkedGroupId) return true;
  return !clips.some((c) => c.type === "audio" && c.linkedGroupId === clip.linkedGroupId && c.id !== clip.id);
}

// ============================================================================
// Canonical timeline -> render worker contract
// ============================================================================

export interface ResolvedClipSource {
  sourceKey?: string;
  sourceUrl?: string;
  mediaType: "video" | "audio" | "image";
}

export type BuildExportResult =
  | { ok: true; timeline: ExportTimeline }
  | { ok: false; error: string; clipId?: string };

export function buildExportTimeline(
  t: EditorTimeline,
  sources: Map<string, ResolvedClipSource>,
  dims: { width: number; height: number; fps?: number },
): BuildExportResult {
  const muted = effectiveMutedTrackIds(t.tracks);
  const tracks: ExportTimelineTrack[] = [];
  for (const track of t.tracks) {
    tracks.push({ id: track.id, kind: track.type, muted: muted.has(track.id), order: track.order, clips: [] });
  }
  const byId = new Map(tracks.map((tr) => [tr.id, tr]));
  // Linked audio clips fade with their video clip.
  const transitionByGroup = new Map<string, ClipTransition>();
  for (const c of t.clips) {
    if (c.type === "video" && c.linkedGroupId && c.transitionIn) transitionByGroup.set(c.linkedGroupId, c.transitionIn);
  }

  for (const c of t.clips) {
    const track = byId.get(c.trackId);
    if (!track) continue;
    const src = sources.get(c.assetId);
    if (!src || (!src.sourceKey && !src.sourceUrl)) {
      return { ok: false, error: "clip_source_unavailable", clipId: c.id };
    }
    const clip: ExportTimelineClip = {
      id: c.id,
      assetId: c.assetId,
      trackId: c.trackId,
      startMs: Math.round(c.timelineStart * 1000),
      endMs: Math.round(c.timelineEnd * 1000),
      sourceInMs: Math.round(c.sourceStart * 1000),
      sourceOutMs: Math.round(c.sourceEnd * 1000),
      sourceUrl: src.sourceUrl || "",
      ...(src.sourceKey ? { sourceKey: src.sourceKey } : {}),
      name: c.displayName || "Clip",
      kind: c.type,
      mediaType: src.mediaType,
      volume: clampVolume(c.volume),
      muted: c.isMuted === true,
      hidden: c.isHidden === true,
      embeddedAudio: videoClipPlaysEmbeddedAudio(c, t.clips),
    };
    const transition =
      c.type === "video" ? c.transitionIn : c.linkedGroupId ? transitionByGroup.get(c.linkedGroupId) : undefined;
    if (transition) clip.transitionIn = transition;
    track.clips.push(clip);
  }

  const durationMs = tracks.reduce((max, tr) => tr.clips.reduce((m, c) => Math.max(m, c.endMs), max), 0);
  if (durationMs <= 0) return { ok: false, error: "timeline_empty" };
  return {
    ok: true,
    timeline: { version: 2, width: dims.width, height: dims.height, fps: dims.fps ?? 30, durationMs, tracks },
  };
}
