import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildRenderPlan, clipSourceId, type RenderInput } from "./renderPlan.js";
import type { ExportTimeline, ExportTimelineClip } from "./exportTypes.js";

function clip(p: Partial<ExportTimelineClip> & { id: string; startMs: number; endMs: number }): ExportTimelineClip {
  return {
    assetId: p.assetId ?? "asset",
    trackId: p.trackId ?? "video_1",
    sourceInMs: 0,
    sourceOutMs: p.endMs - p.startMs,
    sourceUrl: "",
    sourceKey: p.sourceKey ?? "k/a.mp4",
    name: "c",
    kind: "video",
    mediaType: "video",
    volume: 1,
    muted: false,
    hidden: false,
    embeddedAudio: false,
    ...p,
  };
}

function tl(tracks: ExportTimeline["tracks"]): ExportTimeline {
  return { version: 2, width: 1280, height: 720, fps: 30, durationMs: 0, tracks };
}

const opts = { outputPath: "/tmp/out.mp4", width: 1280, height: 720, fps: 30, container: "mp4" };
const av: RenderInput = { path: "/w/a.mp4", hasVideo: true, hasAudio: true };
const music: RenderInput = { path: "/w/m.mp3", hasVideo: false, hasAudio: true };
const silentVideo: RenderInput = { path: "/w/s.mp4", hasVideo: true, hasAudio: false };

function inputs(map: Record<string, RenderInput>) {
  return new Map(Object.entries(map).map(([k, v]) => [`key:${k}`, v]));
}

/** Audio branch filters (everything feeding amix except the bed). */
function audioBranches(fc: string): string[] {
  return fc.split(";").filter((p) => /\[a\d+\]$/.test(p));
}

describe("buildRenderPlan — audio mixing", () => {
  it("linked A/V pair: picture from the video clip, sound from the audio clip, AAC output", () => {
    const plan = buildRenderPlan(
      tl([
        { id: "video_1", kind: "video", muted: false, order: 0, clips: [clip({ id: "v", startMs: 0, endMs: 4000 })] },
        { id: "audio_1", kind: "audio", muted: false, order: 1, clips: [clip({ id: "a", trackId: "audio_1", kind: "audio", startMs: 0, endMs: 4000 })] },
      ]),
      inputs({ "k/a.mp4": av }),
      opts,
    );
    assert.equal(plan.videoBranches, 1);
    assert.equal(plan.audioBranches, 1);
    assert.match(plan.filterComplex, /amix=inputs=2:duration=first:dropout_transition=0:normalize=0\[outa\]/);
    const i = plan.args.indexOf("-c:a");
    assert.equal(plan.args[i + 1], "aac");
    assert.ok(plan.args.includes("[outa]"));
    assert.equal(plan.args[plan.args.indexOf("-t", plan.args.indexOf("-filter_complex")) + 1], "4.000");
  });

  it("muted clip contributes no audio", () => {
    const plan = buildRenderPlan(
      tl([
        { id: "video_1", kind: "video", muted: false, order: 0, clips: [clip({ id: "v", startMs: 0, endMs: 2000 })] },
        { id: "audio_1", kind: "audio", muted: false, order: 1, clips: [clip({ id: "a", trackId: "audio_1", kind: "audio", startMs: 0, endMs: 2000, muted: true })] },
      ]),
      inputs({ "k/a.mp4": av }),
      opts,
    );
    assert.equal(plan.audioBranches, 0);
    assert.match(plan.filterComplex, /\[abase\]anull\[outa\]/);
    assert.equal(plan.videoBranches, 1);
  });

  it("muted track (or a non-soloed track) contributes nothing", () => {
    const plan = buildRenderPlan(
      tl([
        { id: "video_1", kind: "video", muted: false, order: 0, clips: [clip({ id: "v", startMs: 0, endMs: 2000 })] },
        { id: "audio_1", kind: "audio", muted: true, order: 1, clips: [clip({ id: "a", trackId: "audio_1", kind: "audio", startMs: 0, endMs: 2000 })] },
      ]),
      inputs({ "k/a.mp4": av }),
      opts,
    );
    assert.equal(plan.audioBranches, 0);
  });

  it("volume 0.5 is applied as a gain on that clip's branch", () => {
    const plan = buildRenderPlan(
      tl([{ id: "audio_1", kind: "audio", muted: false, order: 1, clips: [clip({ id: "a", trackId: "audio_1", kind: "audio", startMs: 0, endMs: 3000, volume: 0.5, sourceKey: "m.mp3" })] }]),
      inputs({ "m.mp3": music }),
      opts,
    );
    const [branch] = audioBranches(plan.filterComplex);
    assert.match(branch, /volume=0\.5,adelay=0\|0\[a0\]$/);
  });

  it("gain above unity (up to 2) is kept; zero gain is skipped", () => {
    const plan = buildRenderPlan(
      tl([{
        id: "audio_1", kind: "audio", muted: false, order: 1, clips: [
          clip({ id: "loud", trackId: "audio_1", kind: "audio", startMs: 0, endMs: 1000, volume: 5, sourceKey: "m.mp3" }),
          clip({ id: "zero", trackId: "audio_1", kind: "audio", startMs: 1000, endMs: 2000, volume: 0, sourceKey: "m.mp3" }),
        ],
      }]),
      inputs({ "m.mp3": music }),
      opts,
    );
    assert.equal(plan.audioBranches, 1);
    assert.match(audioBranches(plan.filterComplex)[0], /volume=2,/);
  });

  it("audio-only track overlapping video is mixed with the video's embedded audio at its offset", () => {
    const plan = buildRenderPlan(
      tl([
        { id: "video_1", kind: "video", muted: false, order: 0, clips: [clip({ id: "v", startMs: 0, endMs: 6000, embeddedAudio: true })] },
        { id: "music", kind: "audio", muted: false, order: 1, clips: [clip({ id: "m", trackId: "music", kind: "audio", startMs: 2500, endMs: 5000, sourceInMs: 10_000, sourceOutMs: 12_500, volume: 0.8, sourceKey: "m.mp3" })] },
      ]),
      inputs({ "k/a.mp4": av, "m.mp3": music }),
      opts,
    );
    assert.equal(plan.audioBranches, 2);
    const branches = audioBranches(plan.filterComplex);
    assert.match(branches[0], /adelay=0\|0\[a0\]$/);
    assert.match(branches[1], /volume=0\.8,adelay=2500\|2500\[a1\]$/);
    assert.match(plan.filterComplex, /amix=inputs=3/);
    // The music input seeks to its source in-point and reads only the clip length.
    const ss = plan.args.indexOf("10.000");
    assert.ok(ss > 0 && plan.args[ss - 1] === "-ss");
    assert.equal(plan.args[ss + 1], "-t");
    assert.equal(plan.args[ss + 2], "2.500");
  });

  it("clip whose source has no audio stream gets generated silence (no [n:a] reference)", () => {
    const plan = buildRenderPlan(
      tl([{ id: "video_1", kind: "video", muted: false, order: 0, clips: [clip({ id: "v", startMs: 1000, endMs: 3000, embeddedAudio: true, sourceKey: "s.mp4" })] }]),
      inputs({ "s.mp4": silentVideo }),
      opts,
    );
    assert.equal(plan.silentBranches, 1);
    assert.doesNotMatch(plan.filterComplex, /\[0:a\]/);
    assert.match(audioBranches(plan.filterComplex)[0], /^anullsrc=r=48000:cl=stereo,atrim=duration=2\.000,adelay=1000\|1000\[a0\]$/);
  });

  it("gaps: canvas and silent bed span the full timeline; clips are placed at their start", () => {
    const plan = buildRenderPlan(
      tl([
        { id: "video_1", kind: "video", muted: false, order: 0, clips: [
          clip({ id: "v1", startMs: 0, endMs: 2000 }),
          clip({ id: "v2", startMs: 5000, endMs: 7000 }),
        ] },
        { id: "audio_1", kind: "audio", muted: false, order: 1, clips: [
          clip({ id: "a1", trackId: "audio_1", kind: "audio", startMs: 0, endMs: 2000 }),
          clip({ id: "a2", trackId: "audio_1", kind: "audio", startMs: 5000, endMs: 7000 }),
        ] },
      ]),
      inputs({ "k/a.mp4": av }),
      opts,
    );
    assert.equal(plan.durationMs, 7000);
    assert.match(plan.filterComplex, /^color=c=black:s=1280x720:r=30:d=7\.000/);
    assert.match(plan.filterComplex, /anullsrc=r=48000:cl=stereo,atrim=duration=7\.000\[abase\]/);
    assert.match(plan.filterComplex, /setpts=PTS\+5\.000\/TB\[v1\]/);
    assert.match(plan.filterComplex, /enable='between\(t,5\.000,7\.000\)'/);
    assert.match(plan.filterComplex, /adelay=5000\|5000\[a1\]/);
  });

  it("lower-order video track is drawn last (on top); hidden clips are not drawn", () => {
    const plan = buildRenderPlan(
      tl([
        { id: "video_1", kind: "video", muted: false, order: 0, clips: [clip({ id: "top", startMs: 0, endMs: 1000, sourceKey: "top.mp4" })] },
        { id: "video_2", kind: "video", muted: false, order: 2, clips: [
          clip({ id: "bottom", trackId: "video_2", startMs: 0, endMs: 1000, sourceKey: "bottom.mp4" }),
          clip({ id: "hidden", trackId: "video_2", startMs: 1000, endMs: 2000, hidden: true, sourceKey: "bottom.mp4" }),
        ] },
      ]),
      inputs({ "top.mp4": { ...av, path: "/w/top.mp4" }, "bottom.mp4": { ...av, path: "/w/bottom.mp4" } }),
      opts,
    );
    assert.equal(plan.videoBranches, 2);
    const inputsOrder = plan.args.filter((_, i) => plan.args[i - 1] === "-i");
    assert.deepEqual(inputsOrder, ["/w/top.mp4", "/w/bottom.mp4"]);
    // bottom (input 1) is overlaid first, top (input 0) last
    assert.ok(plan.filterComplex.indexOf("[1:v]") < plan.filterComplex.indexOf("[0:v]"));
  });

  it("legacy (pre-v2) jobs: video-track clips keep embedded audio, audio tracks ignored", () => {
    const legacy: ExportTimeline = {
      width: 1280, height: 720, fps: 30, durationMs: 2000,
      tracks: [
        { id: "video_1", kind: "video", muted: false, clips: [{ id: "v", assetId: "x", trackId: "video_1", startMs: 0, endMs: 2000, sourceInMs: 0, sourceOutMs: 2000, sourceUrl: "", sourceKey: "k/a.mp4", name: "v" }] },
        { id: "audio_1", kind: "audio", muted: false, clips: [{ id: "a", assetId: "x", trackId: "audio_1", startMs: 0, endMs: 2000, sourceInMs: 0, sourceOutMs: 2000, sourceUrl: "", sourceKey: "k/a.mp4", name: "a" }] },
      ],
    };
    const plan = buildRenderPlan(legacy, inputs({ "k/a.mp4": av }), opts);
    assert.equal(plan.audioBranches, 1);
    assert.equal(plan.videoBranches, 1);
  });

  it("webm uses VP9 + Opus; everything muted throws", () => {
    const t = tl([{ id: "audio_1", kind: "audio", muted: false, order: 1, clips: [clip({ id: "a", trackId: "audio_1", kind: "audio", startMs: 0, endMs: 1000, sourceKey: "m.mp3" })] }]);
    const plan = buildRenderPlan(t, inputs({ "m.mp3": music }), { ...opts, container: "webm" });
    assert.equal(plan.args[plan.args.indexOf("-c:a") + 1], "libopus");
    t.tracks[0].muted = true;
    assert.throws(() => buildRenderPlan(t, inputs({ "m.mp3": music }), opts), /Nothing audible or visible/);
  });

  it("clipSourceId prefers the storage key", () => {
    assert.equal(clipSourceId({ sourceKey: "a", sourceUrl: "https://x" }), "key:a");
    assert.equal(clipSourceId({ sourceUrl: "https://x" }), "url:https://x");
  });
});

describe("buildRenderPlan — export quality / fps", () => {
  const one = () => tl([{ id: "video_1", kind: "video", muted: false, order: 0, clips: [clip({ id: "v", startMs: 0, endMs: 2000 })] }]);
  const argAfter = (args: string[], flag: string) => args[args.indexOf(flag) + 1];
  it("maps quality to x264 CRF/preset and uses the chosen fps", () => {
    const draft = buildRenderPlan(one(), inputs({ "k/a.mp4": av }), { ...opts, quality: "draft" });
    assert.equal(argAfter(draft.args, "-crf"), "28");
    assert.equal(argAfter(draft.args, "-preset"), "veryfast");
    const high = buildRenderPlan(one(), inputs({ "k/a.mp4": av }), { ...opts, quality: "high", fps: 60 });
    assert.equal(argAfter(high.args, "-crf"), "18");
    assert.ok(high.filterComplex.includes(":r=60:"), "60fps canvas");
    const std = buildRenderPlan(one(), inputs({ "k/a.mp4": av }), opts);
    assert.equal(argAfter(std.args, "-crf"), "23");
  });
  it("webm uses VP9 CRF per quality", () => {
    const p = buildRenderPlan(one(), inputs({ "k/a.mp4": av }), { ...opts, container: "webm", quality: "draft" });
    assert.equal(argAfter(p.args, "-c:v"), "libvpx-vp9");
    assert.equal(argAfter(p.args, "-crf"), "40");
  });
});
