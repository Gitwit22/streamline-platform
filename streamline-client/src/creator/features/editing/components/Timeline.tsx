// ============================================================================
// TIMELINE — Container: ruler + tracks + playhead + snap line
// ============================================================================

import { useCallback, useRef } from 'react';
import { useEditorStore } from '../store/editorStore';
import { PIXELS_PER_SECOND, RULER_HEIGHT, TIMELINE_LEFT_GUTTER_PX } from '../types';
import TrackPanel from './TrackPanel';
import TimelineTrack from './TimelineTrack';
import TimelineRuler from './TimelineRuler';
import Playhead from './Playhead';

export default function Timeline() {
  const tracks = useEditorStore(s => s.tracks);
  const totalDuration = useEditorStore(s => s.totalDuration);
  const zoom = useEditorStore(s => s.zoom);
  const scrollLeft = useEditorStore(s => s.scrollLeft);
  const snapLineX = useEditorStore(s => s.snapLineX);
  const setScrollLeft = useEditorStore(s => s.setScrollLeft);
  const seek = useEditorStore(s => s.seek);

  const containerRef = useRef<HTMLDivElement>(null);

  const sortedTracks = [...tracks].sort((a, b) => a.order - b.order);

  const effectiveDuration = totalDuration || 60;
  const totalWidth = TIMELINE_LEFT_GUTTER_PX + effectiveDuration * PIXELS_PER_SECOND * zoom + 400;

  const handleScroll = useCallback(() => {
    if (containerRef.current) {
      setScrollLeft(containerRef.current.scrollLeft);
    }
  }, [setScrollLeft]);

  // Click empty timeline area → seek
  const handleTimelineClick = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('[data-clip]')) return;
    if ((e.target as HTMLElement).closest('button')) return;

    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const relX = e.clientX - rect.left + container.scrollLeft - TIMELINE_LEFT_GUTTER_PX;
    if (relX < 0) return;
    const time = relX / (PIXELS_PER_SECOND * zoom);
    seek(Math.max(0, time));
  }, [zoom, seek]);

  return (
    <div className="flex flex-1 min-h-0 bg-zinc-950">
      {/* Left: Track header panel */}
      <div style={{ width: `${TIMELINE_LEFT_GUTTER_PX}px`, flexShrink: 0 }}>
        <TrackPanel />
      </div>

      {/* Right: Scrollable timeline area */}
      <div
        ref={containerRef}
        data-timeline-container
        className="flex-1 overflow-x-auto overflow-y-auto relative"
        onScroll={handleScroll}
        onClick={handleTimelineClick}
      >
        <div className="relative" style={{ width: `${totalWidth}px`, minHeight: '100%' }}>
          {/* Ruler */}
          <TimelineRuler />

          {/* Track lanes */}
          <div style={{ paddingTop: `${RULER_HEIGHT}px` }}>
            {sortedTracks.map(track => (
              <TimelineTrack key={track.id} track={track} />
            ))}
          </div>

          {/* Playhead */}
          <Playhead />

          {/* Snap line */}
          {snapLineX !== null && (
            <div
              className="absolute top-0 bottom-0 w-px bg-yellow-400/60 z-20 pointer-events-none"
              style={{ left: `${snapLineX}px` }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
