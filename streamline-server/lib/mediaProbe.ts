/**
 * ffprobe helper: which streams a media file has and how long it is.
 * Used by the render worker (to know which clips need generated silence)
 * and by uploads (so uploaded assets get a real duration).
 */
import { spawn } from "child_process";

const FFPROBE_BIN = process.env.FFPROBE_PATH || "ffprobe";

export interface MediaProbe {
  durationMs: number;
  hasVideo: boolean;
  hasAudio: boolean;
}

/** Pure: parse `ffprobe -print_format json -show_format -show_streams` output. */
export function parseProbeOutput(stdout: string): MediaProbe | null {
  try {
    const info = JSON.parse(stdout);
    const streams: any[] = Array.isArray(info?.streams) ? info.streams : [];
    const dur = parseFloat(info?.format?.duration || "0");
    // Cover art (attached_pic) in audio files is not a video stream.
    const hasVideo = streams.some((s) => s?.codec_type === "video" && s?.disposition?.attached_pic !== 1);
    const hasAudio = streams.some((s) => s?.codec_type === "audio");
    return { durationMs: Number.isFinite(dur) ? Math.round(dur * 1000) : 0, hasVideo, hasAudio };
  } catch {
    return null;
  }
}

/** Probe a local file; null when ffprobe is unavailable or fails. */
export function probeMedia(filePath: string, timeoutMs = 60_000): Promise<MediaProbe | null> {
  return new Promise((resolve) => {
    let stdout = "";
    let done = false;
    const finish = (v: MediaProbe | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(v);
    };
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(FFPROBE_BIN, ["-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", filePath], {
        stdio: ["ignore", "pipe", "ignore"],
      });
    } catch {
      resolve(null);
      return;
    }
    const timer = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch { /* gone */ }
      finish(null);
    }, timeoutMs);
    child.stdout?.on("data", (d: Buffer) => {
      if (stdout.length < 2 * 1024 * 1024) stdout += d.toString();
    });
    child.on("error", () => finish(null));
    child.on("close", (code) => finish(code === 0 ? parseProbeOutput(stdout) : null));
  });
}
