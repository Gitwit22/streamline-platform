// ============================================================================
// SAVED VIDEOS PICKER — Modal to browse and add saved recordings
// ============================================================================

import { useState, useEffect, useCallback } from 'react';
import { editingApi, type Recording } from '../../../../lib/editingApi';
import { useEditorStore } from '../store/editorStore';
import type { SourceAsset } from '../types';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export default function SavedVideosPicker({ isOpen, onClose }: Props) {
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [loading, setLoading] = useState(true);
  const assets = useEditorStore(s => s.assets);
  const tracks = useEditorStore(s => s.tracks);
  const placeAsset = useEditorStore(s => s.placeAsset);
  const addAsset = useEditorStore(s => s.addAsset);

  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    editingApi.getRecordings()
      .then(all => setRecordings(all.filter(r => r.status === 'ready')))
      .catch(() => setRecordings([]))
      .finally(() => setLoading(false));
  }, [isOpen]);

  const handleAdd = useCallback((recording: Recording) => {
    // Create asset if not already present
    const existingAsset = Array.from(assets.values()).find(
      a => (a as SourceAsset & { originalRecordingId?: string }).originalRecordingId === recording.id
    );
    let assetId: string;

    if (existingAsset) {
      assetId = existingAsset.id;
    } else {
      // Add as new asset
      assetId = `asset_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      addAsset({
        id: assetId,
        fileName: recording.title || 'Video',
        type: 'video',
        url: recording.videoUrl || '',
        duration: recording.duration || 60,
        hasVideo: true,
        hasAudio: true,
        originalRecordingId: recording.id,
      } as SourceAsset & { originalRecordingId: string });
    }

    // Place on first video track at the end of existing clips
    const videoTrack = tracks.find(t => t.type === 'video');
    if (videoTrack) {
      const sAsset = assets.get(assetId) || useEditorStore.getState().assets.get(assetId);
      if (sAsset) {
        const clips = useEditorStore.getState().clips;
        const endTime = clips.reduce((max, c) => Math.max(max, c.timelineEnd), 0);
        placeAsset(sAsset, endTime);
      }
    }

    onClose();
  }, [assets, tracks, placeAsset, addAsset, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-[min(620px,90vw)] max-h-[70vh] bg-zinc-900 border border-zinc-700/50 rounded-xl flex flex-col overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="px-5 py-3 border-b border-zinc-800 flex items-center justify-between">
          <h3 className="text-sm font-bold text-white">🎬 Saved Videos</h3>
          <button onClick={onClose} className="text-zinc-500 hover:text-white text-lg transition">✕</button>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <p className="text-zinc-500 text-center py-8">Loading…</p>
          ) : recordings.length === 0 ? (
            <p className="text-zinc-600 text-center py-8">No saved videos found.</p>
          ) : (
            <div className="space-y-1.5">
              {recordings.map(r => (
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
                      <div className="w-full h-full flex items-center justify-center text-zinc-600 text-xs">🎬</div>
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-white truncate">{r.title}</div>
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
