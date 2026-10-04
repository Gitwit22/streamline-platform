// ============================================================================
// TOOLBAR — Top bar: project name, save, export, undo/redo, split, delete
// ============================================================================

import { useState, useCallback, useRef } from 'react';
import { useEditorStore } from '../store/editorStore';
import { editingApi } from '../../../../lib/editingApi';
import { createProject, saveProjectTimeline } from '../../../../lib/projectsApi';
import { useNavigate } from 'react-router-dom';
import SavedVideosPicker from './SavedVideosPicker';
import { editorStateToTimeline, mediaToSourceAsset } from '../engine/projectIO';

export default function Toolbar() {
  const navigate = useNavigate();
  const projectName = useEditorStore(s => s.projectName);
  const isDirty = useEditorStore(s => s.isDirty);
  const saveStatus = useEditorStore(s => s.saveStatus);
  const selectedClipIds = useEditorStore(s => s.selectedClipIds);
  const clips = useEditorStore(s => s.clips);

  const undo = useEditorStore(s => s.undo);
  const redo = useEditorStore(s => s.redo);
  const splitAtPlayhead = useEditorStore(s => s.splitAtPlayhead);
  const deleteClips = useEditorStore(s => s.deleteClipsByIds);
  const snapEnabled = useEditorStore(s => s.snapEnabled);
  const setSnapEnabled = useEditorStore(s => s.setSnapEnabled);
  const setSaveStatus = useEditorStore(s => s.setSaveStatus);

  const [showSavedVideosPicker, setShowSavedVideosPicker] = useState(false);
  const [showAddAssetMenu, setShowAddAssetMenu] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Save: PUT /api/projects/:id/timeline (creates the project on first save
  // when the editor was opened from a library asset).
  const handleSave = useCallback(async (): Promise<string | null> => {
    setSaveStatus('saving');
    try {
      const state = useEditorStore.getState();
      let id = state.projectId;
      if (!id) {
        const created = await createProject(state.projectName || 'Untitled Project');
        id = created.id;
        useEditorStore.getState().setProjectId(id);
      }
      await saveProjectTimeline(id, editorStateToTimeline(state.clips, state.tracks));
      useEditorStore.setState({ isDirty: false });

      setSaveStatus('saved');
      setTimeout(() => {
        if (useEditorStore.getState().saveStatus === 'saved') {
          setSaveStatus('idle');
        }
      }, 2000);
      if (!state.projectId) navigate(`/editing/editor/${encodeURIComponent(id)}`, { replace: true });
      return id;
    } catch (err) {
      console.error('Save failed:', err);
      setSaveStatus('error');
      return null;
    }
  }, [navigate, setSaveStatus]);

  // Export: save pending changes first, then open the render page.
  const handleExport = useCallback(async () => {
    const state = useEditorStore.getState();
    const id = state.isDirty || !state.projectId ? await handleSave() : state.projectId;
    if (id) navigate(`/editing/export/${encodeURIComponent(id)}`);
  }, [handleSave, navigate]);

  // Upload file to the content library, then add it to this project's bin.
  const handleFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setShowAddAssetMenu(false);
    try {
      const result = await editingApi.uploadAsset(file);
      const media = result.asset ?? (await editingApi.getAsset(result.assetId));
      if (!media) throw new Error('Upload finished but the asset could not be loaded');
      useEditorStore.getState().addAsset(mediaToSourceAsset(media));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Upload failed';
      alert(message);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }, []);

  const selectedCount = selectedClipIds.size;
  const hasClips = clips.length > 0;

  const saveLabel = saveStatus === 'saving' ? 'Saving…' : saveStatus === 'saved' ? '✓ Saved' : saveStatus === 'error' ? 'Error!' : 'Save';

  return (
    <>
      <div className="h-12 px-4 flex items-center gap-2 border-b border-zinc-800 bg-zinc-900/80">
        {/* Back */}
        <button
          onClick={() => navigate('/projects')}
          className="text-zinc-400 hover:text-white text-sm transition mr-2"
          title="Back to Projects"
        >
          ← Projects
        </button>

        {/* Project name */}
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-white truncate max-w-[200px]">
            {projectName || 'Untitled'}
          </span>
          {isDirty && <span className="w-2 h-2 rounded-full bg-yellow-500" title="Unsaved changes" />}
        </div>

        <div className="flex-1" />

        {/* Undo / Redo */}
        <div className="flex items-center gap-0.5 mr-2">
          <button onClick={undo} className="w-8 h-8 rounded flex items-center justify-center text-zinc-400 hover:text-white hover:bg-zinc-800 transition text-sm" title="Undo (Ctrl+Z)">
            ↩
          </button>
          <button onClick={redo} className="w-8 h-8 rounded flex items-center justify-center text-zinc-400 hover:text-white hover:bg-zinc-800 transition text-sm" title="Redo (Ctrl+Shift+Z)">
            ↪
          </button>
        </div>

        {/* Split */}
        <button
          onClick={splitAtPlayhead}
          disabled={!hasClips}
          className="px-2.5 h-8 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-medium disabled:opacity-30 disabled:cursor-not-allowed transition border border-zinc-700/50"
          title="Split at Playhead (S)"
        >
          ✂ Split
        </button>

        {/* Delete */}
        <button
          onClick={() => deleteClips(Array.from(selectedClipIds))}
          disabled={selectedCount === 0}
          className="px-2.5 h-8 rounded bg-zinc-800 hover:bg-red-600/50 text-zinc-300 text-xs font-medium disabled:opacity-30 disabled:cursor-not-allowed transition border border-zinc-700/50"
          title="Delete Selected (Delete)"
        >
          🗑 Delete
        </button>

        {/* Snap toggle */}
        <button
          onClick={() => setSnapEnabled(!snapEnabled)}
          className={`px-2.5 h-8 rounded text-xs font-medium transition border
            ${snapEnabled
              ? 'bg-yellow-600/20 text-yellow-300 border-yellow-600/40'
              : 'bg-zinc-800 text-zinc-500 border-zinc-700/50 hover:text-zinc-300'
            }`}
          title="Toggle Snapping (N)"
        >
          🧲 Snap
        </button>

        <div className="w-px h-6 bg-zinc-700 mx-1" />

        {/* Add Asset dropdown */}
        <div className="relative">
          <button
            onClick={() => setShowAddAssetMenu(!showAddAssetMenu)}
            className="px-3 h-8 rounded bg-green-600 hover:bg-green-500 text-white text-xs font-medium transition flex items-center gap-1.5"
          >
            + Add Asset ▾
          </button>
          {showAddAssetMenu && (
            <div className="absolute right-0 mt-1 w-44 bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl z-50 overflow-hidden">
              <button
                onClick={() => { setShowAddAssetMenu(false); setShowSavedVideosPicker(true); }}
                className="w-full px-3 py-2 text-xs text-left text-zinc-200 hover:bg-zinc-700 transition"
              >
                🎬 From Library
              </button>
              <button
                onClick={() => { setShowAddAssetMenu(false); fileInputRef.current?.click(); }}
                className="w-full px-3 py-2 text-xs text-left text-zinc-200 hover:bg-zinc-700 transition"
              >
                📁 Upload File
              </button>
            </div>
          )}
        </div>

        {/* Save */}
        <button
          onClick={() => { void handleSave(); }}
          disabled={saveStatus === 'saving'}
          className={`px-3 h-8 rounded text-xs font-medium transition border
            ${saveStatus === 'saved'
              ? 'bg-green-600/20 text-green-300 border-green-600/40'
              : saveStatus === 'error'
                ? 'bg-red-600/20 text-red-300 border-red-600/40'
                : 'bg-indigo-600 hover:bg-indigo-500 text-white border-indigo-500/40'
            }`}
        >
          {uploading ? 'Uploading…' : saveLabel}
        </button>

        {/* Export */}
        <button
          onClick={handleExport}
          disabled={!hasClips || saveStatus === 'saving'}
          className="px-3 h-8 rounded text-xs font-medium transition border bg-red-600 hover:bg-red-500 text-white border-red-500/40 disabled:opacity-30 disabled:cursor-not-allowed"
          title="Render the timeline (video + mixed audio)"
        >
          Export
        </button>
      </div>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="video/*,audio/*,image/*"
        className="hidden"
        onChange={handleFileUpload}
      />

      {/* Saved Videos Picker */}
      <SavedVideosPicker
        isOpen={showSavedVideosPicker}
        onClose={() => setShowSavedVideosPicker(false)}
      />
    </>
  );
}
