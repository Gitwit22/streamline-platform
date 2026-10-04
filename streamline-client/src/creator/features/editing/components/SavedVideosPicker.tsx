// ============================================================================
// LIBRARY PICKER — add any content library MediaAsset (recording, upload,
// saved/exported video, audio, image) to the timeline. The clip references the
// asset by its library id, so the server can resolve it for export.
// ============================================================================

import { useState, useEffect, useCallback } from 'react';
import { editingApi, type MediaAsset } from '../../../../lib/editingApi';
import { useEditorStore } from '../store/editorStore';
import { mediaToSourceAsset } from '../engine/projectIO';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

const TYPE_ICON: Record<MediaAsset['type'], string> = {
  recording: '📡',
  video: '🎬',
  audio: '🎵',
  image: '🖼️',
};

export default function SavedVideosPicker({ isOpen, onClose }: Props) {
  const [items, setItems] = useState<MediaAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const placeAsset = useEditorStore(s => s.placeAsset);
  const addAsset = useEditorStore(s => s.addAsset);

  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    editingApi.getMediaAssets()
      .then(all => setItems(all.filter(a => a.status === 'ready' && !!a.videoUrl)))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, [isOpen]);

  const handleAdd = useCallback((media: MediaAsset) => {
    const existing = useEditorStore.getState().assets.get(media.id);
    const asset = existing ?? mediaToSourceAsset(media);
    if (!existing) addAsset(asset);

    // Place at the end of the existing timeline
    const clips = useEditorStore.getState().clips;
    const endTime = clips.reduce((max, c) => Math.max(max, c.timelineEnd), 0);
    placeAsset(asset, endTime);

    onClose();
  }, [placeAsset, addAsset, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-[min(620px,90vw)] max-h-[70vh] bg-zinc-900 border border-zinc-700/50 rounded-xl flex flex-col overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="px-5 py-3 border-b border-zinc-800 flex items-center justify-between">
          <h3 className="text-sm font-bold text-white">🎬 Content Library</h3>
          <button onClick={onClose} className="text-zinc-500 hover:text-white text-lg transition">✕</button>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <p className="text-zinc-500 text-center py-8">Loading…</p>
          ) : items.length === 0 ? (
            <p className="text-zinc-600 text-center py-8">No media in your library yet.</p>
          ) : (
            <div className="space-y-1.5">
              {items.map(r => (
                <div
                  key={r.id}
                  onClick={() => handleAdd(r)}
                  className="flex items-center gap-3 p-2.5 rounded-lg border border-transparent hover:border-zinc-700/50 hover:bg-zinc-800/60 cursor-pointer transition group"
                >
                  {/* Thumbnail */}
                  <div className="w-[72px] h-10 rounded-md overflow-hidden bg-zinc-800 flex-shrink-0">
                    {r.thumbnailUrl ? (
                      <img src={r.thumbnailUrl} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-zinc-600 text-xs">{TYPE_ICON[r.type] || '🎬'}</div>
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-white truncate">{r.name}</div>
                    <div className="text-[11px] text-zinc-500">
                      {Math.floor(r.duration / 60)}:{String(Math.floor(r.duration % 60)).padStart(2, '0')}
                      {r.roomName ? ` • ${r.roomName}` : ''}
                    </div>
                  </div>

                  <span className="text-xs text-green-400 font-semibold opacity-0 group-hover:opacity-100 transition">
                    + Add
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-zinc-800 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-sm rounded-md bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700/50 transition"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
