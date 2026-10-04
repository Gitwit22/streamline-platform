// ============================================================================
// EDITOR PAGE — Slim route wrapper: loads project, hydrates store, renders layout
//
// Data flow (canonical):
//   GET /api/projects/:id  -> { project, timeline (v2), mediaAssets, projectAssets }
//   PUT /api/projects/:id/timeline (Toolbar save)
//   New project from the library: /editing/editor/new?recordingId=|assetId=
//     -> GET /api/editing/assets/:id, project created on first save
// ============================================================================

import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { editingApi } from '../../../lib/editingApi';
import { getProjectForEditor } from '../../../lib/projectsApi';

import { useEditorStore } from './store/editorStore';
import { defaultTracks, mediaToSourceAsset, payloadToEditorState, sequence } from './engine/projectIO';
import EditorLayout from './components/EditorLayout';
import RawVideoViewer from './components/RawVideoViewer';

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function EditorPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const hydrate = useEditorStore(s => s.hydrateProject);
  const reset = useEditorStore(s => s.resetEditor);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        if (projectId === 'new') {
          await loadNewProject();
        } else if (projectId) {
          await loadExistingProject(projectId);
        }
      } catch (err) {
        if (!cancelled) {
          console.error('[editor] Load failed:', err);
          setError('Failed to load project');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    // ── NEW PROJECT (from a library asset; saved on first Save) ─────────
    async function loadNewProject() {
      const id = searchParams.get('assetId') || searchParams.get('recordingId');
      const media = id ? await editingApi.getAsset(id) : null;
      if (cancelled) return;
      const tracks = defaultTracks();
      if (media) {
        const asset = mediaToSourceAsset(media);
        hydrate({
          projectId: null,
          projectName: media.name ? `Edit: ${media.name}` : 'Untitled Project',
          tracks,
          clips: sequence([asset], tracks),
          assets: new Map([[asset.id, asset]]),
        });
        return;
      }
      hydrate({ projectId: null, projectName: 'Untitled Project', tracks, clips: [], assets: new Map() });
    }

    // ── EXISTING PROJECT ────────────────────────────────────────────────
    async function loadExistingProject(id: string) {
      const payload = await getProjectForEditor(id);
      if (cancelled) return;
      if (!payload?.project) {
        setError('Project not found');
        return;
      }
      // Legacy ids resolve to the canonical project; keep the URL canonical.
      if (payload.project.id !== id) {
        navigate(`/editing/editor/${encodeURIComponent(payload.project.id)}`, { replace: true });
        return;
      }
      const state = payloadToEditorState(payload);
      hydrate({
        projectId: payload.project.id,
        projectName: payload.project.name || 'Untitled',
        ...state,
      });
    }

    load();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // Cleanup on unmount
  useEffect(() => {
    return () => reset();
  }, [reset]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-zinc-950 text-white">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-red-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-zinc-400 text-sm">Loading editor…</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-screen bg-zinc-950 text-white">
        <div className="text-center">
          <p className="text-red-400 text-lg mb-2">⚠ {error}</p>
          <button
            onClick={() => window.history.back()}
            className="text-sm text-zinc-400 hover:text-white underline"
          >
            Go back
          </button>
        </div>
      </div>
    );
  }

  // Raw viewer for assets opened from the content library, timeline otherwise
  const isRawView = searchParams.get('view') === 'raw';

  return isRawView ? <RawVideoViewer /> : <EditorLayout />;
}
