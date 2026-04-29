// ============================================================================
// SNAP ENGINE — Finds magnetic snap points during drag/trim operations
// ============================================================================

import type { TimelineClip } from '../types';
import { SNAP_THRESHOLD_PX, PIXELS_PER_SECOND } from '../types';

export interface SnapResult {
  snappedTime: number;
  snapLineX: number | null; // pixel position of snap indicator, null if no snap
  snapType: 'playhead' | 'clip-start' | 'clip-end' | 'zero' | null;
}

/**
 * Find the nearest snap point for a given time position.
 * Returns the snapped time if within threshold, or the original time.
 */
export function findSnapPoint(
  time: number,
  clips: TimelineClip[],
  playheadTime: number,
  zoom: number,
  excludeClipIds?: Set<string>,
): SnapResult {
  const thresholdTime = SNAP_THRESHOLD_PX / (PIXELS_PER_SECOND * zoom);
  
  // Collect all snap targets
  const targets: Array<{ time: number; type: SnapResult['snapType'] }> = [
    { time: 0, type: 'zero' },
    { time: playheadTime, type: 'playhead' },
  ];

  for (const clip of clips) {
    if (excludeClipIds?.has(clip.id)) continue;
    targets.push({ time: clip.timelineStart, type: 'clip-start' });
    targets.push({ time: clip.timelineEnd, type: 'clip-end' });
  }

  // Find the closest target within threshold
  let closest: { time: number; type: SnapResult['snapType']; distance: number } | null = null;

  for (const target of targets) {
    const distance = Math.abs(time - target.time);
    if (distance <= thresholdTime && (!closest || distance < closest.distance)) {
      closest = { time: target.time, type: target.type, distance };
    }
  }

  if (closest) {
    return {
      snappedTime: closest.time,
      snapLineX: closest.time * PIXELS_PER_SECOND * zoom,
      snapType: closest.type,
    };
  }

  return { snappedTime: time, snapLineX: null, snapType: null };
}
