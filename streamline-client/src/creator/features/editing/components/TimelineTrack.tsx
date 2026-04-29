// ============================================================================
// TIMELINE TRACK — Single track lane that renders clips + drop zone
// ============================================================================

import { useCallback } from 'react';
import { useEditorStore } from '../store/editorStore';
import { TRACK_HEIGHT, PIXELS_PER_SECOND } from '../types';
import type { Track } from '../types';
import TimelineClipComponent from './TimelineClip';

interface Props {
  track: Track;
}

export default function TimelineTrack({ track }: Props) {
  const clips = useEditorStore(s => s.clips);
  const zoom = useEditorStore(s => s.zoom);
  const clearSelection = useEditorStore(s => s.clearSelection);
  const placeAsset = useEditorStore(s => s.placeAsset);
  const assets = useEditorStore(s => s.assets);

  const trackClips = clips.filter(c => c.trackId === track.id);

  // Click on empty area → deselect
  const handleClick = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('[data-clip]')) return;
    clearSelection();
  }, [clearSelection]);

  // Drop handler for asset drag from AssetBin
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const assetId = e.dataTransfer.getData('application/x-asset-id');
    if (!assetId) return;
    const asset = assets.get(assetId);
    if (!asset) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const scrollContainer = e.currentTarget.closest('[data-timeline-container]');
    const scrollLeft = scrollContainer ? scrollContainer.scrollLeft : 0;
    const relX = e.clientX - rect.left + scrollLeft;
    const dropTime = Math.max(0, relX / (PIXELS_PER_SECOND * zoom));

    placeAsset(asset, dropTime);
  }, [zoom, placeAsset, assets]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (e.dataTransfer.types.includes('application/x-asset-id')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }
  }, []);

  return (
    <div
      className={`relative border-b border-zinc-800/60 ${track.isLocked ? 'opacity-50 pointer-events-none' : ''}`}
      style={{ height: `${TRACK_HEIGHT}px` }}
      onClick={handleClick}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
    >
      {/* Track background stripes */}
      <div className="absolute inset-0 bg-zinc-900/30" />

      {/* Clips */}
      {trackClips.map(clip => (
        <TimelineClipComponent key={clip.id} clip={clip} />
      ))}

      {/* Drop indicator */}
      {track.isLocked && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <span className="text-zinc-600 text-xs">🔒 Locked</span>
        </div>
      )}
    </div>
  );
}
