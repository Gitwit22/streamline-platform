// ============================================================================
// TRANSITION PREVIEW — approximate how transitions look at the playhead.
// The export renders them exactly (server renderPlan); the preview dims the
// picture over the same windows so the editor shows where they happen.
// Crossfades preview as a fade (the preview shows one clip at a time).
// ============================================================================

import type { TimelineClip } from '../types';

const ADJACENT_SEC = 0.04;

/** Picture opacity 0..1 for the active video clip at `time`. */
export function transitionOpacityAt(time: number, active: TimelineClip | null, clips: TimelineClip[]): number {
  if (!active) return 1;
  let opacity = 1;
  const tr = active.transitionIn;
  const len = active.timelineEnd - active.timelineStart;
  if (tr) {
    const touchingPrev = clips.some(
      (c) => c.id !== active.id && c.trackId === active.trackId && c.type === 'video' && !c.isHidden &&
        Math.abs(c.timelineEnd - active.timelineStart) <= ADJACENT_SEC,
    );
    const dur = Math.min(tr.durationMs / 1000, len);
    const fadeIn = tr.type === 'dip_to_black' && touchingPrev ? dur / 2 : dur;
    const t = time - active.timelineStart;
    if (fadeIn > 0 && t >= 0 && t < fadeIn) opacity = Math.min(opacity, t / fadeIn);
  }
  // Dip to black on the NEXT touching clip fades this one out.
  const next = clips.find(
    (c) => c.id !== active.id && c.trackId === active.trackId && c.type === 'video' && !c.isHidden &&
      c.transitionIn?.type === 'dip_to_black' && Math.abs(c.timelineStart - active.timelineEnd) <= ADJACENT_SEC,
  );
  if (next?.transitionIn) {
    const out = Math.min(next.transitionIn.durationMs / 1000 / 2, len);
    const remaining = active.timelineEnd - time;
    if (out > 0 && remaining >= 0 && remaining < out) opacity = Math.min(opacity, remaining / out);
  }
  return Math.max(0, Math.min(1, opacity));
}
