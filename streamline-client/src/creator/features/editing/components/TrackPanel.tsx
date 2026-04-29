// ============================================================================
// TRACK PANEL — Left sidebar with track headers + add-track buttons
// ============================================================================

import { useEditorStore } from '../store/editorStore';
import TrackHeader from './TrackHeader';
import { RULER_HEIGHT } from '../types';

export default function TrackPanel() {
  const tracks = useEditorStore(s => s.tracks);
  const addTrack = useEditorStore(s => s.addTrack);

  const sortedTracks = [...tracks].sort((a, b) => a.order - b.order);

  return (
    <div className="flex flex-col bg-zinc-900 border-r border-zinc-800">
      {/* Ruler spacer */}
      <div
        className="border-b border-zinc-700 bg-zinc-900/80 flex items-center justify-center"
        style={{ height: `${RULER_HEIGHT}px` }}
      >
        <span className="text-[9px] text-zinc-600 font-medium uppercase tracking-wider">Tracks</span>
      </div>

      {/* Track headers */}
      {sortedTracks.map(trk => (
        <TrackHeader key={trk.id} track={trk} />
      ))}

      {/* Add track buttons */}
      <div className="p-1.5 flex gap-1 border-t border-zinc-800">
        <button
          onClick={() => addTrack('video')}
          className="flex-1 text-[9px] py-1 bg-zinc-800/60 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 rounded transition"
        >
          + Video
        </button>
        <button
          onClick={() => addTrack('audio')}
          className="flex-1 text-[9px] py-1 bg-zinc-800/60 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 rounded transition"
        >
          + Audio
        </button>
      </div>
    </div>
  );
}
