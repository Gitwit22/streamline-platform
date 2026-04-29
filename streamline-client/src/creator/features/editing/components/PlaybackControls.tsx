// ============================================================================
// PLAYBACK CONTROLS — Play/pause, seek, time display, zoom
// ============================================================================

import { useEditorStore } from '../store/editorStore';
import { formatTimecode } from '../types';

export default function PlaybackControls() {
  const playheadTime = useEditorStore(s => s.playheadTime);
  const isPlaying = useEditorStore(s => s.isPlaying);
  const totalDuration = useEditorStore(s => s.totalDuration);
  const zoom = useEditorStore(s => s.zoom);
  const togglePlayPause = useEditorStore(s => s.togglePlayPause);
  const seek = useEditorStore(s => s.seek);
  const zoomIn = useEditorStore(s => s.zoomIn);
  const zoomOut = useEditorStore(s => s.zoomOut);

  return (
    <div className="h-12 px-4 flex items-center gap-3 border-t border-zinc-800 bg-zinc-900/80">
      {/* Transport */}
      <button
        onClick={() => seek(0)}
        className="w-8 h-8 flex items-center justify-center text-zinc-400 hover:text-white rounded hover:bg-zinc-800 transition text-sm"
        title="Go to start (Home)"
      >
        ⏮
      </button>
      <button
        onClick={togglePlayPause}
        className="w-10 h-10 bg-red-600 hover:bg-red-500 rounded-full flex items-center justify-center transition shadow-lg shadow-red-900/30"
        title="Play/Pause (Space)"
      >
        <span className="text-white text-lg">{isPlaying ? '⏸' : '▶'}</span>
      </button>
      <button
        onClick={() => seek(totalDuration)}
        className="w-8 h-8 flex items-center justify-center text-zinc-400 hover:text-white rounded hover:bg-zinc-800 transition text-sm"
        title="Go to end (End)"
      >
        ⏭
      </button>

      {/* Time display */}
      <div className="font-mono text-sm bg-zinc-800/80 px-3 py-1.5 rounded-md border border-zinc-700/50 select-none">
        <span className="text-white">{formatTimecode(playheadTime)}</span>
        <span className="text-zinc-600 mx-1.5">/</span>
        <span className="text-zinc-400">{formatTimecode(totalDuration)}</span>
      </div>

      <div className="flex-1" />

      {/* Zoom */}
      <div className="flex items-center gap-1.5 text-sm">
        <button
          onClick={zoomOut}
          className="w-7 h-7 bg-zinc-800 hover:bg-zinc-700 rounded flex items-center justify-center text-zinc-300 transition border border-zinc-700/50"
        >
          −
        </button>
        <span className="w-14 text-center text-zinc-400 text-xs font-mono select-none">
          {Math.round(zoom * 100)}%
        </span>
        <button
          onClick={zoomIn}
          className="w-7 h-7 bg-zinc-800 hover:bg-zinc-700 rounded flex items-center justify-center text-zinc-300 transition border border-zinc-700/50"
        >
          +
        </button>
      </div>
    </div>
  );
}
