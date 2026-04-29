// ============================================================================
// EDITOR LAYOUT — 3-column layout composing all editor UI components
// ============================================================================

import { useEffect, useCallback } from 'react';
import { useEditorStore } from '../store/editorStore';
import Toolbar from './Toolbar';
import VideoPreview from './VideoPreview';
import PlaybackControls from './PlaybackControls';
import Timeline from './Timeline';
import AssetBin from './AssetBin';
import ClipInspector from './ClipInspector';

export default function EditorLayout() {
  const togglePlayPause = useEditorStore(s => s.togglePlayPause);
  const undo = useEditorStore(s => s.undo);
  const redo = useEditorStore(s => s.redo);
  const splitAtPlayhead = useEditorStore(s => s.splitAtPlayhead);
  const deleteClips = useEditorStore(s => s.deleteClipsByIds);
  const selectedClipIds = useEditorStore(s => s.selectedClipIds);
  const seek = useEditorStore(s => s.seek);
  const totalDuration = useEditorStore(s => s.totalDuration);
  const snapEnabled = useEditorStore(s => s.snapEnabled);
  const setSnapEnabled = useEditorStore(s => s.setSnapEnabled);

  // Keyboard shortcuts
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    // Ignore when typing in inputs
    const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return;

    switch (e.key) {
      case ' ':
        e.preventDefault();
        togglePlayPause();
        break;
      case 'z':
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          if (e.shiftKey) redo();
          else undo();
        }
        break;
      case 'y':
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          redo();
        }
        break;
      case 's':
        if (!(e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          splitAtPlayhead();
        }
        break;
      case 'Delete':
      case 'Backspace':
        if (selectedClipIds.size > 0) {
          e.preventDefault();
          deleteClips(Array.from(selectedClipIds));
        }
        break;
      case 'Home':
        e.preventDefault();
        seek(0);
        break;
      case 'End':
        e.preventDefault();
        seek(totalDuration);
        break;
      case 'n':
        if (!(e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          setSnapEnabled(!snapEnabled);
        }
        break;
    }
  }, [togglePlayPause, undo, redo, splitAtPlayhead, deleteClips, selectedClipIds, seek, totalDuration, snapEnabled, setSnapEnabled]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  return (
    <div className="flex flex-col h-screen bg-zinc-950 text-white overflow-hidden">
      {/* Top toolbar */}
      <Toolbar />

      {/* Main content: 3-column layout */}
      <div className="flex flex-1 min-h-0">
        {/* Left panel: Asset Bin */}
        <div className="w-56 border-r border-zinc-800 bg-zinc-900/50 flex flex-col flex-shrink-0">
          <AssetBin />
        </div>

        {/* Center: Preview + Timeline */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Video preview */}
          <div className="flex-shrink-0">
            <VideoPreview />
          </div>

          {/* Playback controls */}
          <PlaybackControls />

          {/* Timeline */}
          <Timeline />
        </div>

        {/* Right panel: Clip Inspector */}
        <div className="w-52 border-l border-zinc-800 bg-zinc-900/50 flex flex-col flex-shrink-0">
          <ClipInspector />
        </div>
      </div>
    </div>
  );
}
