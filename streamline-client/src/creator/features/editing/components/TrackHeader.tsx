// ============================================================================
// TRACK HEADER — Track label + mute/solo/lock toggle buttons
// ============================================================================

import { useEditorStore } from '../store/editorStore';
import type { Track } from '../types';
import { TRACK_HEIGHT } from '../types';

interface Props {
  track: Track;
}

export default function TrackHeader({ track }: Props) {
  const toggleTrackMute = useEditorStore(s => s.toggleMute);
  const toggleTrackSolo = useEditorStore(s => s.toggleSolo);
  const toggleTrackLock = useEditorStore(s => s.toggleLock);

  const isVideo = track.type === 'video';
  const icon = isVideo ? '🎬' : '🔊';

  return (
    <div
      className="flex items-center gap-1.5 px-2 border-b border-zinc-800 bg-zinc-900"
      style={{ height: `${TRACK_HEIGHT}px` }}
    >
      <span className="text-xs opacity-50">{icon}</span>
      <span className="text-[11px] text-zinc-300 font-medium truncate flex-1">
        {track.name}
      </span>

      <div className="flex items-center gap-0.5">
        {/* Mute */}
        <button
          onClick={() => toggleTrackMute(track.id)}
          className={`w-5 h-5 rounded text-[9px] flex items-center justify-center transition
            ${track.isMuted ? 'bg-red-600/40 text-red-300' : 'bg-zinc-800 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-700'}`}
          title={track.isMuted ? 'Unmute track' : 'Mute track'}
        >
          M
        </button>

        {/* Solo */}
        <button
          onClick={() => toggleTrackSolo(track.id)}
          className={`w-5 h-5 rounded text-[9px] flex items-center justify-center transition
            ${track.isSolo ? 'bg-yellow-600/40 text-yellow-300' : 'bg-zinc-800 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-700'}`}
          title={track.isSolo ? 'Unsolo track' : 'Solo track'}
        >
          S
        </button>

        {/* Lock */}
        <button
          onClick={() => toggleTrackLock(track.id)}
          className={`w-5 h-5 rounded text-[9px] flex items-center justify-center transition
            ${track.isLocked ? 'bg-zinc-600/40 text-zinc-300' : 'bg-zinc-800 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-700'}`}
          title={track.isLocked ? 'Unlock track' : 'Lock track'}
        >
          L
        </button>
      </div>
    </div>
  );
}
