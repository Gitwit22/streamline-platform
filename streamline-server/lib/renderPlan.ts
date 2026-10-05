/**
 * Render plan — pure FFmpeg argument / filter-graph builder for exports.
 *
 * Picture: a black canvas of the full timeline length; every visible video
 * clip (unmuted track, not hidden) is scaled/padded to the output size,
 * shifted to its timeline start and overlaid for [start, end). Tracks are
 * drawn bottom-up (highest order first) so the lowest-order track ends on
 * top, matching the editor preview. Gaps stay black.
 *
 * Sound: a silent bed of the full length (anullsrc) mixed (amix,
 * normalize=0, so gains are not divided by the input count) with one branch
 * per audible clip:
 *   - audio clips (music / voiceover / the audio half of an A/V pair)
 *   - video clips whose embedded audio is not represented by a linked audio
 *     clip (ExportTimelineClip.embeddedAudio)
 * each trimmed to its source range, resampled to 48 kHz stereo, scaled by
 * the clip gain (0..2) and delayed to its timeline start. Muted clips, muted
 * tracks (incl. solo) and zero-gain clips are skipped. A clip whose source
 * has no audio stream contributes generated silence (anullsrc) of its length
 * so the graph never references a missing [n:a] pad.
 *
 * Output: H.264 + AAC (mp4 / mov) or VP9 + Opus (webm), 48 kHz stereo.
 *
 * Jobs created before timeline version 2 keep their old meaning: clips on
 * video tracks render picture + embedded audio, audio tracks are ignored
 * (old timelines stored duplicate A/V clips there).
 */
import type { ExportTimeline, ExportTimelineClip, ExportTimelineTrack } from "./exportTypes";

import { qualityEncoding } from "./exportPolicyPure";

export interface RenderInput {
  /** Local file path of the downloaded source. */
  path: string;
  hasVideo: boolean;
  hasAudio: boolean;
}

export interface RenderPlanOptions {
  outputPath: string;
  width: number;
  height: number;
  fps: number;
  container: string;
  /** "draft" | "standard" | "high" (default standard). */
  quality?: string;
}

export interface RenderPlan {
  args: string[];
  filterComplex: string;
  durationMs: number;
  /** Clips drawn on the canvas. */
  videoBranches: number;
  /** Audio branches mixed over the silent bed (incl. generated silence). */
  audioBranches: number;
  /** Audio branches that are generated silence (source has no audio). */
  silentBranches: number;
}

/** Map key for de-duplicating downloads (storage key preferred over URL). */
export function clipSourceId(clip: Pick<ExportTimelineClip, "sourceKey" | "sourceUrl">): string {
  return clip.sourceKey ? `key:${clip.sourceKey}` : clip.sourceUrl ? `url:${clip.sourceUrl}` : "";
}

const sec = (ms: number) => (Math.max(0, ms) / 1000).toFixed(3);

/** Clips this close are treated as touching (a cut, eligible for a transition). */
const ADJACENT_MS = 40;

/** Per-clip effects derived from transitions (all in ms; 0 = none). */
export interface ClipEffects {
  /** Picture fades in over this long. */
  fadeInMs: number;
  /** Fade in via alpha (reveals what is underneath) instead of from black. */
  fadeInAlpha: boolean;
  /** Picture fades out to black over the last fadeOutMs (dip to black). */
  fadeOutMs: number;
  /** Last frame is held this long past the clip's end (crossfade under the next clip). */
  holdMs: number;
  /** Sound fades in / out. */
  afadeInMs: number;
  afadeOutMs: number;
}

const NO_EFFECTS: ClipEffects = { fadeInMs: 0, fadeInAlpha: false, fadeOutMs: 0, holdMs: 0, afadeInMs: 0, afadeOutMs: 0 };

/**
 * Resolve clip transitions into concrete fades:
 *   fade          picture alpha-fades in over D; sound fades in over D.
 *   dip_to_black  previous touching clip fades out to black over D/2, this
 *                 clip fades in from black over D/2 (sound the same).
 *                 With no previous clip: fade in from black over D.
 *   crossfade     previous touching clip holds its last frame for D while
 *                 this clip alpha-fades in over it; sound dips over D/2 each
 *                 side. With no previous clip: same as fade.
 * Durations are clamped to the clips involved.
 */
export function planClipEffects(
  clips: Array<Pick<NormalizedClip, "clip" | "track" | "durMs" | "picture" | "audio">>,
): Map<string, ClipEffects> {
  const fx = new Map<string, ClipEffects>();
  const get = (id: string) => {
    let e = fx.get(id);
    if (!e) {
      e = { ...NO_EFFECTS };
      fx.set(id, e);
    }
    return e;
  };
  const prevTouching = (c: (typeof clips)[number], want: "picture" | "audio") =>
    clips
      .filter(
        (o) =>
          o !== c &&
          o[want] &&
          o.track.id === c.track.id &&
          Math.abs(o.clip.endMs - c.clip.startMs) <= ADJACENT_MS,
      )
      .sort((a, b) => b.clip.endMs - a.clip.endMs)[0];

  for (const c of clips) {
    const tr = c.clip.transitionIn;
    if (!tr) continue;
    const D = Math.max(0, Math.min(tr.durationMs, c.durMs));
    if (D <= 0) continue;

    if (c.picture) {
      const prev = prevTouching(c, "picture");
      const e = get(c.clip.id);
      if (tr.type === "dip_to_black" && prev) {
        const half = Math.min(D / 2, prev.durMs);
        e.fadeInMs = D / 2;
        e.fadeInAlpha = false;
        const pe = get(prev.clip.id);
        pe.fadeOutMs = Math.max(pe.fadeOutMs, half);
      } else if (tr.type === "dip_to_black") {
        e.fadeInMs = D;
        e.fadeInAlpha = false;
      } else {
        // fade, or crossfade (prev frame held underneath)
        e.fadeInMs = D;
        e.fadeInAlpha = true;
        if (tr.type === "crossfade" && prev) {
          const pe = get(prev.clip.id);
          pe.holdMs = Math.max(pe.holdMs, D);
        }
      }
    }

    if (c.audio) {
      const prev = tr.type === "fade" ? undefined : prevTouching(c, "audio");
      const e = get(c.clip.id);
      if (prev) {
        e.afadeInMs = D / 2;
        const pe = get(prev.clip.id);
        pe.afadeOutMs = Math.max(pe.afadeOutMs, Math.min(D / 2, prev.durMs));
      } else {
        e.afadeInMs = D;
      }
    }
  }
  return fx;
}
const gain = (v: number) => (Math.round(v * 1000) / 1000).toString();

interface NormalizedClip {
  clip: ExportTimelineClip;
  track: ExportTimelineTrack;
  input: RenderInput;
  durMs: number;
  picture: boolean;
  audio: boolean;
  isImage: boolean;
  volume: number;
}

function normalize(timeline: ExportTimeline, inputs: Map<string, RenderInput>): NormalizedClip[] {
  const v2 = timeline.version === 2;
  const out: NormalizedClip[] = [];
  for (const track of timeline.tracks) {
    for (const clip of track.clips) {
      const input = inputs.get(clipSourceId(clip));
      if (!input) continue;
      const durMs = Math.max(0, clip.endMs - clip.startMs);
      if (durMs <= 0) continue;
      const kind = clip.kind ?? track.kind;
      const isImage = clip.mediaType === "image";
      const volume = typeof clip.volume === "number" && Number.isFinite(clip.volume) ? Math.max(0, Math.min(2, clip.volume)) : 1;
      const trackOn = !track.muted;

      const picture = trackOn && kind === "video" && track.kind === "video" && clip.hidden !== true && (input.hasVideo || isImage);
      let audio: boolean;
      if (!v2) {
        audio = trackOn && track.kind === "video";
      } else {
        const wantsAudio = kind === "audio" || clip.embeddedAudio === true;
        audio = trackOn && wantsAudio && !isImage && clip.muted !== true && volume > 0;
      }
      if (!picture && !audio) continue;
      out.push({ clip, track, input, durMs, picture, audio, isImage, volume });
    }
  }
  return out;
}

export function buildRenderPlan(
  timeline: ExportTimeline,
  inputs: Map<string, RenderInput>,
  opts: RenderPlanOptions,
): RenderPlan {
  const clips = normalize(timeline, inputs);
  const allEnds = timeline.tracks.flatMap((t) => t.clips.map((c) => c.endMs));
  const durationMs = Math.max(timeline.durationMs || 0, ...allEnds, 0);
  if (durationMs <= 0) throw new Error("Timeline is empty — nothing to render");
  if (!clips.some((c) => c.picture || c.audio)) throw new Error("Nothing audible or visible to render (all clips/tracks muted or hidden)");

  const W = opts.width;
  const H = opts.height;
  const fps = opts.fps || 30;
  const T = sec(durationMs);

  // One FFmpeg input per clip that needs its source file (same file may be
  // opened several times with different seek windows).
  const args: string[] = ["-hide_banner", "-nostdin"];
  const inputIndex = new Map<NormalizedClip, number>();
  let nextInput = 0;
  for (const c of clips) {
    const needsFile = c.picture || (c.audio && c.input.hasAudio);
    if (!needsFile) continue;
    if (c.isImage) {
      args.push("-loop", "1", "-framerate", String(fps), "-t", sec(c.durMs), "-i", c.input.path);
    } else {
      args.push("-ss", sec(c.clip.sourceInMs), "-t", sec(c.durMs), "-i", c.input.path);
    }
    inputIndex.set(c, nextInput++);
  }

  const parts: string[] = [];

  // ── Picture ──
  parts.push(`color=c=black:s=${W}x${H}:r=${fps}:d=${T},format=yuv420p[bg0]`);
  const pictureClips = clips
    .filter((c) => c.picture)
    .sort((a, b) => (b.track.order ?? 0) - (a.track.order ?? 0) || a.clip.startMs - b.clip.startMs);
  const effects = planClipEffects(clips);
  let bg = 0;
  pictureClips.forEach((c, k) => {
    const i = inputIndex.get(c)!;
    const fxc = effects.get(c.clip.id) || NO_EFFECTS;
    const s = sec(c.clip.startMs);
    const e = sec(c.clip.endMs + fxc.holdMs);
    // Fades run on clip-local time, before the clip is shifted to its start.
    let fades = "";
    if (fxc.holdMs > 0) fades += `tpad=stop_mode=clone:stop_duration=${sec(fxc.holdMs)},`;
    if (fxc.fadeOutMs > 0) fades += `fade=t=out:st=${sec(c.durMs - fxc.fadeOutMs)}:d=${sec(fxc.fadeOutMs)},`;
    const pixfmt = fxc.fadeInMs > 0 && fxc.fadeInAlpha ? "yuva420p" : "yuv420p";
    if (fxc.fadeInMs > 0) {
      fades += `format=${pixfmt},fade=t=in:st=0:d=${sec(fxc.fadeInMs)}${fxc.fadeInAlpha ? ":alpha=1" : ""},`;
    }
    parts.push(
      `[${i}:v]trim=duration=${sec(c.durMs)},setpts=PTS-STARTPTS,` +
        `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,setsar=1,` +
        `fps=${fps},${fades}format=${pixfmt},setpts=PTS+${s}/TB[v${k}]`,
    );
    parts.push(`[bg${bg}][v${k}]overlay=eof_action=pass:enable='between(t,${s},${e})'[bg${bg + 1}]`);
    bg++;
  });
  parts.push(`[bg${bg}]null[outv]`);

  // ── Sound ──
  parts.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${T}[abase]`);
  const audioClips = clips.filter((c) => c.audio).sort((a, b) => a.clip.startMs - b.clip.startMs);
  const audioLabels: string[] = [];
  let silent = 0;
  audioClips.forEach((c, k) => {
    const delay = Math.round(c.clip.startMs);
    const label = `a${k}`;
    if (c.input.hasAudio) {
      const i = inputIndex.get(c)!;
      const fxc = effects.get(c.clip.id) || NO_EFFECTS;
      let afades = "";
      if (fxc.afadeInMs > 0) afades += `afade=t=in:st=0:d=${sec(fxc.afadeInMs)},`;
      if (fxc.afadeOutMs > 0) afades += `afade=t=out:st=${sec(c.durMs - fxc.afadeOutMs)}:d=${sec(fxc.afadeOutMs)},`;
      parts.push(
        `[${i}:a]atrim=duration=${sec(c.durMs)},asetpts=PTS-STARTPTS,aresample=48000,` +
          `aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,` +
          `${afades}volume=${gain(c.volume)},adelay=${delay}|${delay}[${label}]`,
      );
    } else {
      silent++;
      parts.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${sec(c.durMs)},adelay=${delay}|${delay}[${label}]`);
    }
    audioLabels.push(`[${label}]`);
  });
  if (audioLabels.length === 0) {
    parts.push(`[abase]anull[outa]`);
  } else {
    parts.push(
      `[abase]${audioLabels.join("")}amix=inputs=${audioLabels.length + 1}:duration=first:dropout_transition=0:normalize=0[outa]`,
    );
  }

  const filterComplex = parts.join(";");
  args.push("-filter_complex", filterComplex, "-map", "[outv]", "-map", "[outa]");

  const enc = qualityEncoding(opts.quality, opts.container);
  if (opts.container === "webm") {
    args.push("-c:v", "libvpx-vp9", "-b:v", "0", "-crf", String(enc.crf), "-row-mt", "1", "-c:a", "libopus", "-b:a", "128k");
  } else {
    args.push("-c:v", "libx264", "-preset", enc.preset || "fast", "-crf", String(enc.crf), "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k");
  }
  args.push("-ar", "48000", "-ac", "2", "-t", T);
  if (opts.container !== "webm") args.push("-movflags", "+faststart");
  args.push("-y", opts.outputPath);

  return {
    args,
    filterComplex,
    durationMs,
    videoBranches: pictureClips.length,
    audioBranches: audioLabels.length,
    silentBranches: silent,
  };
}
