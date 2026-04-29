// ============================================================================
// RAW VIDEO VIEWER — Full-page video player for viewing assets from My Content
// Shows the raw video with native controls + a button to open the timeline editor
// ============================================================================

import { useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useEditorStore } from '../store/editorStore';

export default function RawVideoViewer() {
  const nav = useNavigate();
  const videoRef = useRef<HTMLVideoElement>(null);

  const projectName = useEditorStore(s => s.projectName);
  const assets = useEditorStore(s => s.assets);

  // Get the first (and usually only) asset for raw viewing
  const asset = assets.size > 0 ? assets.values().next().value : null;
  const videoUrl = asset?.url || '';
  const title = asset?.fileName || projectName || 'Untitled';

  const handleOpenTimeline = useCallback(() => {
    // Already hydrated — just switch to editor mode via search param removal
    const url = new URL(window.location.href);
    url.searchParams.delete('view');
    nav(url.pathname + url.search, { replace: true });
  }, [nav]);

  const handleBack = useCallback(() => {
    nav('/content');
  }, [nav]);

  return (
    <div className="flex flex-col h-screen bg-zinc-950 text-white">
      {/* Top bar */}
      <div className="h-12 px-4 flex items-center justify-between border-b border-zinc-800 bg-zinc-900/80 shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={handleBack}
            className="text-sm text-zinc-400 hover:text-white transition-colors flex items-center gap-1"
          >
            ← Back
          </button>
          <div className="w-px h-5 bg-zinc-700" />
          <span className="text-sm font-medium text-zinc-200 truncate max-w-[300px]">
            {title}
          </span>
        </div>
        <button
          onClick={handleOpenTimeline}
          className="px-3 py-1.5 text-xs font-semibold rounded-md bg-red-600 hover:bg-red-500 transition-colors"
        >
          Open in Timeline →
        </button>
      </div>

      {/* Video area */}
      <div className="flex-1 flex items-center justify-center bg-black min-h-0">
        {videoUrl ? (
          <video
            ref={videoRef}
            src={videoUrl}
            controls
            autoPlay
            className="max-w-full max-h-full"
            style={{ objectFit: 'contain' }}
          />
        ) : (
          <div className="text-center text-zinc-500">
            <p className="text-lg mb-2">No video available</p>
            <p className="text-sm">This asset doesn't have a playable video URL.</p>
          </div>
        )}
      </div>
    </div>
  );
}
