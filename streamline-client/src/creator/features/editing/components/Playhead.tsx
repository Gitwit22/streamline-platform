// ============================================================================
// PLAYHEAD — Red vertical line across all tracks with scrub handle
// ============================================================================

import { useCallback, useRef } from 'react';
import { useEditorStore } from '../store/editorStore';
import { PIXELS_PER_SECOND, TIMELINE_LEFT_GUTTER_PX, formatTimecode } from '../types';

export default function Playhead() {
  const playheadTime = useEditorStore(s => s.playheadTime);
  const zoom = useEditorStore(s => s.zoom);
  const seek = useEditorStore(s => s.seek);
  const totalDuration = useEditorStore(s => s.totalDuration);
  const isDragging = useRef(false);

  const px = TIMELINE_LEFT_GUTTER_PX + playheadTime * PIXELS_PER_SECOND * zoom;

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    isDragging.current = true;

    const onMove = (ev: MouseEvent) => {
      if (!isDragging.current) return;
      const timeline = (e.target as HTMLElement).closest('[data-timeline-container]');
      if (!timeline) return;
      const rect = timeline.getBoundingClientRect();
      const scrollLeft = (timeline as HTMLElement).scrollLeft || 0;
      const relX = ev.clientX - rect.left + scrollLeft - TIMELINE_LEFT_GUTTER_PX;
      const time = Math.max(0, relX / (PIXELS_PER_SECOND * zoom));
      seek(Math.min(time, totalDuration || 60));
    };

    const onUp = () => {
      isDragging.current = false;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [zoom, seek, totalDuration]);

  return (
    <div
      className="absolute top-0 bottom-0 z-30 pointer-events-none"
      style={{ left: `${px}px`, width: 0 }}
    >
      {/* Vertical line */}
      <div className="absolute top-0 bottom-0 w-0.5 bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]" style={{ left: '-1px' }} />

      {/* Scrub handle (pointer-events enabled) */}
      <div
        className="absolute -top-1 pointer-events-auto cursor-grab active:cursor-grabbing"
        style={{ left: '-6px', width: '12px' }}
        onMouseDown={handleMouseDown}
      >
        {/* Diamond shape */}
        <div className="w-3 h-3 bg-red-500 rotate-45 mx-auto shadow-md shadow-red-500/50 hover:bg-red-400 transition" />
      </div>

      {/* Time label */}
      <div className="absolute -top-6 left-1/2 -translate-x-1/2 bg-red-600 text-white px-1.5 py-0.5 rounded text-[9px] font-mono font-bold whitespace-nowrap shadow-lg pointer-events-none select-none">
        {formatTimecode(playheadTime)}
      </div>
    </div>
  );
}
