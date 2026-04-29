// ============================================================================
// TIMELINE RULER — Time markers with click-to-seek
// ============================================================================

import { useCallback } from 'react';
import { useEditorStore } from '../store/editorStore';
import { PIXELS_PER_SECOND, TIMELINE_LEFT_GUTTER_PX, RULER_HEIGHT } from '../types';

export default function TimelineRuler() {
  const totalDuration = useEditorStore(s => s.totalDuration);
  const zoom = useEditorStore(s => s.zoom);
  const seek = useEditorStore(s => s.seek);

  const effectiveDuration = totalDuration || 60;

  // Adaptive marker intervals based on zoom
  const majorInterval = zoom >= 2 ? 1 : zoom >= 1 ? 5 : 10;
  const minorInterval = zoom >= 2 ? 0.5 : 1;

  const handleClick = useCallback((e: React.MouseEvent) => {
    const target = e.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();
    const scrollLeft = target.closest('[data-timeline-container]')?.scrollLeft || 0;
    const relX = e.clientX - rect.left + scrollLeft - TIMELINE_LEFT_GUTTER_PX;
    const time = Math.max(0, relX / (PIXELS_PER_SECOND * zoom));
    seek(time);
  }, [zoom, seek]);

  const majorCount = Math.ceil(effectiveDuration / majorInterval) + 1;
  const minorCount = Math.ceil(effectiveDuration / minorInterval) + 1;

  return (
    <div
      className="absolute top-0 left-0 right-0 bg-gradient-to-b from-zinc-800 to-zinc-900 border-b border-zinc-700 cursor-pointer select-none z-40"
      style={{ height: `${RULER_HEIGHT}px` }}
      onClick={handleClick}
    >
      {/* Major markers */}
      {Array.from({ length: majorCount }).map((_, i) => {
        const t = i * majorInterval;
        const x = TIMELINE_LEFT_GUTTER_PX + t * PIXELS_PER_SECOND * zoom;
        const mins = Math.floor(t / 60);
        const secs = Math.floor(t % 60);
        const label = `${mins}:${secs.toString().padStart(2, '0')}`;
        return (
          <div key={`major-${i}`} className="absolute top-0 bottom-0" style={{ left: `${x}px` }}>
            <div className="w-px h-3 bg-zinc-500 absolute bottom-0" />
            <span className="absolute top-1 left-1 text-[9px] font-mono text-zinc-400 whitespace-nowrap select-none">
              {label}
            </span>
          </div>
        );
      })}

      {/* Minor markers */}
      {Array.from({ length: minorCount }).map((_, i) => {
        const t = i * minorInterval;
        if (t % majorInterval === 0) return null;
        const x = TIMELINE_LEFT_GUTTER_PX + t * PIXELS_PER_SECOND * zoom;
        return (
          <div key={`minor-${i}`} className="absolute bottom-0" style={{ left: `${x}px` }}>
            <div className="w-px h-1.5 bg-zinc-700" />
          </div>
        );
      })}
    </div>
  );
}
