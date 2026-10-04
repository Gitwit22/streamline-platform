// ============================================================================
// CLIP INSPECTOR — Right panel: selected clip properties, volume, unlink
// ============================================================================

import { useEditorStore } from '../store/editorStore';
import { MAX_CLIP_VOLUME, clipDuration, formatTimecode, videoClipPlaysEmbeddedAudio } from '../types';

export default function ClipInspector() {
  const selectedClipIds = useEditorStore(s => s.selectedClipIds);
  const clips = useEditorStore(s => s.clips);
  const assets = useEditorStore(s => s.assets);
  const deleteClips = useEditorStore(s => s.deleteClipsByIds);
  const unlinkClips = useEditorStore(s => s.unlinkClips);
  const setClipVolume = useEditorStore(s => s.setClipVolume);
  const setClipMuted = useEditorStore(s => s.setClipMuted);

  const selectedIds = Array.from(selectedClipIds);
  const selectedClips = clips.filter(c => selectedIds.includes(c.id));

  if (selectedClips.length === 0) {
    return (
      <div className="flex flex-col h-full">
        <div className="px-3 py-2 border-b border-zinc-800">
          <h3 className="text-xs font-semibold text-zinc-300 uppercase tracking-wider">Inspector</h3>
        </div>
        <div className="flex-1 flex items-center justify-center text-zinc-600 text-xs text-center p-4">
          <div>
            <p className="text-2xl mb-2 opacity-40">🔍</p>
            <p>Select a clip to inspect</p>
          </div>
        </div>
      </div>
    );
  }

  if (selectedClips.length > 1) {
    return (
      <div className="flex flex-col h-full">
        <div className="px-3 py-2 border-b border-zinc-800">
          <h3 className="text-xs font-semibold text-zinc-300 uppercase tracking-wider">Inspector</h3>
        </div>
        <div className="p-3 space-y-3">
          <p className="text-xs text-zinc-400">{selectedClips.length} clips selected</p>
          <button
            onClick={() => deleteClips(selectedIds)}
            className="w-full text-xs py-1.5 bg-red-600/20 hover:bg-red-600/40 text-red-300 rounded transition"
          >
            Delete Selected
          </button>
        </div>
      </div>
    );
  }

  const clip = selectedClips[0];
  const asset = assets.get(clip.assetId);
  const duration = clipDuration(clip);
  const isLinked = !!clip.linkedGroupId;
  // Audio controls apply to audio clips and to video clips that carry their own
  // (embedded) audio; a linked video clip's sound is controlled on its audio clip.
  const hasAudioControls = clip.type === 'audio' || videoClipPlaysEmbeddedAudio(clip, clips);
  const volumePct = Math.round(clip.volume * 100);

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 border-b border-zinc-800">
        <h3 className="text-xs font-semibold text-zinc-300 uppercase tracking-wider">Inspector</h3>
      </div>

      <div className="p-3 space-y-3 text-xs overflow-y-auto flex-1">
        {/* Clip name & type */}
        <div>
          <label className="text-zinc-500 text-[10px] uppercase tracking-wider">Name</label>
          <p className="text-zinc-200 mt-0.5 truncate">{clip.displayName || asset?.fileName || 'Untitled'}</p>
        </div>

        <div className="flex gap-3">
          <div className="flex-1">
            <label className="text-zinc-500 text-[10px] uppercase tracking-wider">Type</label>
            <p className={`mt-0.5 ${clip.type === 'video' ? 'text-indigo-300' : 'text-emerald-300'}`}>
              {clip.type === 'video' ? '🎬 Video' : '🔊 Audio'}
            </p>
          </div>
          {isLinked && (
            <div className="flex-1">
              <label className="text-zinc-500 text-[10px] uppercase tracking-wider">Linked</label>
              <p className="mt-0.5 text-yellow-300">🔗 Yes</p>
            </div>
          )}
        </div>

        {/* Timeline position */}
        <div className="flex gap-3">
          <div className="flex-1">
            <label className="text-zinc-500 text-[10px] uppercase tracking-wider">Start</label>
            <p className="text-zinc-200 mt-0.5 font-mono">{formatTimecode(clip.timelineStart)}</p>
          </div>
          <div className="flex-1">
            <label className="text-zinc-500 text-[10px] uppercase tracking-wider">End</label>
            <p className="text-zinc-200 mt-0.5 font-mono">{formatTimecode(clip.timelineEnd)}</p>
          </div>
        </div>

        <div>
          <label className="text-zinc-500 text-[10px] uppercase tracking-wider">Duration</label>
          <p className="text-zinc-200 mt-0.5 font-mono">{formatTimecode(duration)}</p>
        </div>

        {/* Source range */}
        <div className="border-t border-zinc-800 pt-2">
          <label className="text-zinc-500 text-[10px] uppercase tracking-wider">Source Range</label>
          <p className="text-zinc-400 mt-0.5 font-mono text-[10px]">
            {formatTimecode(clip.sourceStart)} → {formatTimecode(clip.sourceEnd)}
          </p>
        </div>

        {/* Volume / mute */}
        <div className="border-t border-zinc-800 pt-2">
          <div className="flex items-center justify-between">
            <label htmlFor={`clip-volume-${clip.id}`} className="text-zinc-500 text-[10px] uppercase tracking-wider">Volume</label>
            {hasAudioControls && (
              <button
                type="button"
                onClick={() => setClipMuted(clip.id, !clip.isMuted)}
                aria-pressed={clip.isMuted}
                className={`px-1.5 py-0.5 rounded text-[10px] font-semibold transition ${clip.isMuted ? 'bg-red-600/40 text-red-200' : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'}`}
                title={clip.isMuted ? 'Unmute clip' : 'Mute clip'}
              >
                {clip.isMuted ? 'Muted' : 'Mute'}
              </button>
            )}
          </div>
          {hasAudioControls ? (
            <>
              <div className="flex items-center gap-2 mt-1">
                <input
                  id={`clip-volume-${clip.id}`}
                  type="range"
                  min={0}
                  max={MAX_CLIP_VOLUME}
                  step={0.01}
                  value={clip.volume}
                  disabled={clip.isMuted}
                  onChange={(e) => setClipVolume(clip.id, Number(e.target.value))}
                  onDoubleClick={() => setClipVolume(clip.id, 1)}
                  className="flex-1 accent-indigo-500 h-1 disabled:opacity-40"
                  aria-valuetext={`${volumePct}%`}
                />
                <span className="text-zinc-400 font-mono w-12 text-right">{clip.isMuted ? 'muted' : `${volumePct}%`}</span>
              </div>
              {clip.volume > 1 && !clip.isMuted && (
                <p className="text-[10px] text-zinc-500 mt-1">Boost above 100% applies to the export; preview plays at 100%.</p>
              )}
            </>
          ) : (
            <p className="text-[10px] text-zinc-500 mt-1">Sound for this clip is on its linked audio clip.</p>
          )}
        </div>

        {/* Actions */}
        <div className="border-t border-zinc-800 pt-2 space-y-1.5">
          {isLinked && (
            <button
              onClick={() => clip.linkedGroupId && unlinkClips(clip.linkedGroupId)}
              className="w-full text-[11px] py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded transition"
            >
              🔗 Unlink A/V
            </button>
          )}
          <button
            onClick={() => deleteClips([clip.id])}
            className="w-full text-[11px] py-1.5 bg-red-600/20 hover:bg-red-600/40 text-red-300 rounded transition"
          >
            🗑 Delete Clip
          </button>
        </div>
      </div>
    </div>
  );
}
