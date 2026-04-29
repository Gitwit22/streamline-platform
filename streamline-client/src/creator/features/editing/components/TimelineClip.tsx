// ============================================================================
// TIMELINE CLIP — Individual clip block with trim handles + drag-to-move
// ============================================================================

import { useCallback, useRef } from 'react';
import { useEditorStore } from '../store/editorStore';
import { PIXELS_PER_SECOND, MIN_CLIP_DURATION, clipDuration, formatTimecode } from '../types';
import type { TimelineClip as TClip } from '../types';
import { findSnapPoint } from '../engine/snapEngine';

interface Props {
  clip: TClip;
}

const TRIM_ZONE_PX = 8;

export default function TimelineClipComponent({ clip }: Props) {
  const zoom = useEditorStore(s => s.zoom);
  const selectedClipIds = useEditorStore(s => s.selectedClipIds);
  const hoveredClipId = useEditorStore(s => s.hoveredClipId);
  const snapEnabled = useEditorStore(s => s.snapEnabled);
  const clips = useEditorStore(s => s.clips);
  const playheadTime = useEditorStore(s => s.playheadTime);
  const assets = useEditorStore(s => s.assets);

  const selectClip = useEditorStore(s => s.selectClip);
  const toggleClipSelection = useEditorStore(s => s.toggleClipSelection);
  const hoverClip = useEditorStore(s => s.setHoveredClip);
  const moveClips = useEditorStore(s => s.moveClips);
  const trimClipStart = useEditorStore(s => s.trimStart);
  const trimClipEnd = useEditorStore(s => s.trimEnd);
  const setDragState = useEditorStore(s => s.setDragState);
  const setSnapLineX = useEditorStore(s => s.setSnapLineX);

  const dragRef = useRef<{ startX: number; origTimelineStart: number; mode: 'move' | 'trim-start' | 'trim-end' } | null>(null);

  const isSelected = selectedClipIds.has(clip.id);
  const isHovered = hoveredClipId === clip.id;
  const isVideo = clip.type === 'video';
  const duration = clipDuration(clip);
  const widthPx = duration * PIXELS_PER_SECOND * zoom;
  const leftPx = clip.timelineStart * PIXELS_PER_SECOND * zoom;

  const asset = assets.get(clip.assetId);
  const displayName = clip.displayName || asset?.fileName || (isVideo ? 'Video' : 'Audio');

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    const rect = (e.target as HTMLElement).closest('[data-clip]')!.getBoundingClientRect();
    const relX = e.clientX - rect.left;

    let mode: 'move' | 'trim-start' | 'trim-end' = 'move';
    if (relX < TRIM_ZONE_PX) mode = 'trim-start';
    else if (relX > rect.width - TRIM_ZONE_PX) mode = 'trim-end';

    // Select on mouse down
    if (!isSelected) {
      if (e.shiftKey) toggleClipSelection(clip.id);
      else selectClip(clip.id);
    }

    dragRef.current = {
      startX: e.clientX,
      origTimelineStart: clip.timelineStart,
      mode,
    };

    setDragState({ clipId: clip.id, mode, startX: e.clientX, currentX: e.clientX });

    const excludeIds = new Set([clip.id]);

    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      const dx = ev.clientX - dragRef.current.startX;
      const dt = dx / (PIXELS_PER_SECOND * zoom);

      if (dragRef.current.mode === 'move') {
        let newStart = dragRef.current.origTimelineStart + dt;
        if (newStart < 0) newStart = 0;

        // Snap
        if (snapEnabled) {
          const snap = findSnapPoint(newStart, clips, playheadTime, zoom, excludeIds);
          if (snap.snapType) {
            newStart = snap.snappedTime;
            setSnapLineX(snap.snapLineX);
          } else {
            setSnapLineX(null);
          }
          // Also try snapping the end
          const newEnd = newStart + duration;
          const snapEnd = findSnapPoint(newEnd, clips, playheadTime, zoom, excludeIds);
          if (snapEnd.snapType && Math.abs(snapEnd.snappedTime - newEnd) < Math.abs(newStart - (dragRef.current.origTimelineStart + dt))) {
            newStart = snapEnd.snappedTime - duration;
            setSnapLineX(snapEnd.snapLineX);
          }
        }

        moveClips([clip.id], newStart - clip.timelineStart);
        setDragState({ clipId: clip.id, mode: 'move', startX: dragRef.current.startX, currentX: ev.clientX });
      } else if (dragRef.current.mode === 'trim-start') {
        const newStart = Math.max(0, dragRef.current.origTimelineStart + dt);
        const maxStart = clip.timelineEnd - MIN_CLIP_DURATION;
        trimClipStart(clip.id, Math.min(newStart, maxStart));
      } else if (dragRef.current.mode === 'trim-end') {
        const origEnd = clip.timelineEnd;
        const newEnd = origEnd + dt;
        const minEnd = clip.timelineStart + MIN_CLIP_DURATION;
        trimClipEnd(clip.id, Math.max(newEnd, minEnd));
      }
    };

    const onUp = () => {
      dragRef.current = null;
      setDragState(null);
      setSnapLineX(null);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [clip, isSelected, zoom, selectClip, toggleClipSelection, moveClips, trimClipStart, trimClipEnd, snapEnabled, clips, playheadTime, setDragState, setSnapLineX, duration]);

  // Cursor logic
  const getCursor = (e: React.MouseEvent) => {
    const rect = (e.target as HTMLElement).closest('[data-clip]')?.getBoundingClientRect();
    if (!rect) return;
    const relX = e.clientX - rect.left;
    const el = e.currentTarget as HTMLElement;
    if (relX < TRIM_ZONE_PX || relX > rect.width - TRIM_ZONE_PX) {
      el.style.cursor = 'col-resize';
    } else {
      el.style.cursor = 'grab';
    }
  };

  return (
    <div
      data-clip={clip.id}
      className={`absolute top-1 bottom-1 rounded-md border transition-shadow overflow-hidden select-none group
        ${isVideo
          ? 'bg-gradient-to-b from-indigo-600/80 to-indigo-800/80 border-indigo-500/40'
          : 'bg-gradient-to-b from-emerald-600/80 to-emerald-800/80 border-emerald-500/40'
        }
        ${isSelected ? 'ring-2 ring-white/60 shadow-lg shadow-indigo-500/30' : ''}
        ${isHovered && !isSelected ? 'ring-1 ring-white/30' : ''}
      `}
      style={{ left: `${leftPx}px`, width: `${Math.max(widthPx, 4)}px` }}
      onMouseDown={handleMouseDown}
      onMouseMove={getCursor}
      onMouseEnter={() => hoverClip(clip.id)}
      onMouseLeave={() => hoverClip(null)}
    >
      {/* Trim handles */}
      <div className="absolute left-0 top-0 bottom-0 w-2 opacity-0 group-hover:opacity-100 bg-white/20 cursor-col-resize rounded-l transition-opacity" />
      <div className="absolute right-0 top-0 bottom-0 w-2 opacity-0 group-hover:opacity-100 bg-white/20 cursor-col-resize rounded-r transition-opacity" />

      {/* Content */}
      <div className="px-2 py-1 truncate text-[10px] font-medium text-white/90 pointer-events-none">
        <span className="mr-1 opacity-60">{isVideo ? '🎬' : '🔊'}</span>
        {displayName}
      </div>

      {/* Duration label at bottom */}
      {widthPx > 60 && (
        <div className="absolute bottom-0.5 right-1.5 text-[8px] text-white/40 pointer-events-none font-mono">
          {formatTimecode(duration)}
        </div>
      )}

      {/* Linked indicator */}
      {clip.linkedGroupId && (
        <div className="absolute top-0.5 right-1 text-[8px] opacity-40 pointer-events-none" title="Linked A/V">
          🔗
        </div>
      )}

      {/* Muted indicator */}
      {clip.isMuted && (
        <div className="absolute inset-0 bg-zinc-900/50 flex items-center justify-center pointer-events-none">
          <span className="text-zinc-400 text-xs">Muted</span>
        </div>
      )}
    </div>
  );
}
