// ============================================================================
// ASSET BIN — Media panel listing source assets, drag-to-timeline, upload
// ============================================================================

import { useCallback } from 'react';
import { useEditorStore } from '../store/editorStore';
import { formatTimecode } from '../types';
import type { SourceAsset } from '../types';

export default function AssetBin() {
  const assets = useEditorStore(s => s.assets);
  const placeAsset = useEditorStore(s => s.placeAsset);

  const assetList = Array.from(assets.values());

  // Double-click or button → place at playhead on first matching track
  const handleAddToTimeline = useCallback((assetId: string) => {
    const asset = assets.get(assetId);
    if (!asset) return;
    const playheadTime = useEditorStore.getState().playheadTime;
    placeAsset(asset, playheadTime);
  }, [assets, placeAsset]);

  // Drag start → set dataTransfer
  const handleDragStart = useCallback((e: React.DragEvent, assetId: string) => {
    e.dataTransfer.setData('application/x-asset-id', assetId);
    e.dataTransfer.effectAllowed = 'copy';
  }, []);

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 border-b border-zinc-800 flex items-center justify-between">
        <h3 className="text-xs font-semibold text-zinc-300 uppercase tracking-wider">Assets</h3>
        <span className="text-[10px] text-zinc-600">{assetList.length} items</span>
      </div>

      <div className="flex-1 overflow-y-auto p-1.5 space-y-1">
        {assetList.length === 0 ? (
          <div className="text-center py-8 text-zinc-600 text-xs">
            <p className="text-3xl mb-2 opacity-40">📁</p>
            <p>No assets yet</p>
            <p className="text-zinc-700 mt-1">Add media from your library</p>
          </div>
        ) : (
          assetList.map(asset => (
            <div
              key={asset.id}
              draggable
              onDragStart={(e) => handleDragStart(e, asset.id)}
              onDoubleClick={() => handleAddToTimeline(asset.id)}
              className="flex items-center gap-2 p-2 rounded-md bg-zinc-800/40 hover:bg-zinc-800 cursor-grab active:cursor-grabbing transition group border border-transparent hover:border-zinc-700/50"
            >
              {/* Thumbnail */}
              <div className={`w-10 h-7 rounded flex items-center justify-center text-xs flex-shrink-0
                ${asset.type === 'video' ? 'bg-indigo-900/40 text-indigo-400' : 'bg-emerald-900/40 text-emerald-400'}`}>
                {asset.type === 'video' ? '🎬' : '🔊'}
              </div>

              <div className="flex-1 min-w-0">
                <div className="text-[11px] text-zinc-300 truncate">{asset.fileName}</div>
                <div className="text-[9px] text-zinc-600 font-mono">
                  {formatTimecode(asset.duration)}
                </div>
              </div>

              {/* Quick add button */}
              <button
                onClick={(e) => { e.stopPropagation(); handleAddToTimeline(asset.id); }}
                className="w-5 h-5 bg-zinc-700/50 hover:bg-indigo-600 rounded flex items-center justify-center opacity-0 group-hover:opacity-100 transition text-[10px] text-zinc-300"
                title="Add to timeline"
              >
                +
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
