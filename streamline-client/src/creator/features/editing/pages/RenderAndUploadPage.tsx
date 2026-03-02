import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { CheckCircle, Youtube, Facebook, Twitter } from 'lucide-react';
import { editingApi, type Project } from '../../../../lib/editingApi';

export default function RenderAndUploadPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const [project, setProject] = useState<Project | null>(null);
  const [renderProgress, setRenderProgress] = useState(0);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const start = async () => {
      setLoading(true);
      setError(null);
      setDownloadUrl(null);
      setRenderProgress(0);
      setUploadProgress(0);

      if (!projectId) {
        setLoading(false);
        return;
      }

      try {
        const proj = await editingApi.getProject(projectId);
        if (cancelled) return;
        if (!proj) {
          setProject(null);
          setLoading(false);
          return;
        }
        setProject(proj as Project);

        const started = await editingApi.startExport(
          projectId,
          { format: 'mp4', resolution: '1080p' } as any
        );

        if (cancelled) return;
        if (typeof (started as any)?.progress === 'number') {
          setRenderProgress((started as any).progress);
        }

        if ((started as any)?.status === 'complete') {
          setRenderProgress(100);
          setUploadProgress(100);
          setDownloadUrl(((started as any)?.downloadUrl as string) || null);
          setLoading(false);
          return;
        }

        const finalJob = await editingApi.waitForExport((started as any).id, (job: any) => {
          if (cancelled) return;
          if (typeof job?.progress === 'number') {
            setRenderProgress(job.progress);
          }
        });

        if (cancelled) return;
        setRenderProgress(100);
        setUploadProgress(100);
        setDownloadUrl((finalJob as any)?.downloadUrl || null);
        setLoading(false);
      } catch (e: any) {
        if (cancelled) return;
        setError(e?.message || String(e));
        setLoading(false);
      }
    };

    start();

    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const isRendering = renderProgress < 100;
  const isUploading = renderProgress === 100 && uploadProgress < 100;
  const isComplete = renderProgress === 100 && uploadProgress === 100;

  if (loading) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-purple-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-zinc-400">Loading project...</p>
        </div>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        <div className="text-center">
          {error ? (
            <>
              <p className="text-red-400 mb-2">Export failed</p>
              <p className="text-zinc-400 mb-6">{error}</p>
            </>
          ) : (
            <p className="text-zinc-400 mb-6">Project not found</p>
          )}
          <button
            onClick={() => navigate('/editing/projects')}
            className="px-6 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 transition"
          >
            Back to Projects
          </button>
        </div>
      </div>
    );
  }

  const duration = project.duration || 120; // Default 2 minutes

  return (
    <div className="min-h-screen bg-black text-white flex items-center justify-center p-6">
      <div className="max-w-3xl w-full">
        {/* Header */}
        <div className="text-center mb-12">
          {isRendering && (
            <>
              <div className="w-20 h-20 border-4 border-purple-500 border-t-transparent rounded-full animate-spin mx-auto mb-6"></div>
              <h1 className="text-3xl font-bold mb-2">Rendering Your Video</h1>
              <p className="text-zinc-400">Processing {project.name}...</p>
            </>
          )}
          {isUploading && (
            <>
              <div className="w-20 h-20 bg-gradient-to-r from-blue-500 to-cyan-500 rounded-full flex items-center justify-center mx-auto mb-6 animate-pulse">
                <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                  />
                </svg>
              </div>
              <h1 className="text-3xl font-bold mb-2">Finalizing Export</h1>
              <p className="text-zinc-400">Preparing your download...</p>
            </>
          )}
          {isComplete && (
            <>
              <div className="w-20 h-20 bg-gradient-to-r from-emerald-500 to-teal-500 rounded-full flex items-center justify-center mx-auto mb-6">
                <CheckCircle className="w-10 h-10" />
              </div>
              <h1 className="text-3xl font-bold mb-2">Export Complete</h1>
              <p className="text-zinc-400">Your video is ready to download</p>
            </>
          )}
        </div>

        {/* Render progress bar */}
        {isRendering && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-8 mb-6">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-medium">Rendering Video</span>
              <span className="text-sm text-purple-400 font-mono">{Math.round(renderProgress)}%</span>
            </div>
            <div className="h-3 bg-zinc-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-purple-500 to-pink-500 transition-all duration-200"
                style={{ width: `${renderProgress}%` }}
              ></div>
            </div>
            <div className="mt-4 text-xs text-zinc-500">
              Processing with FFmpeg • 1080p @ 30fps
            </div>
          </div>
        )}

        {/* Platform uploads */}
        {(isUploading || isComplete) && (
          <div className="space-y-4 mb-8">
            {/* YouTube */}
            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6">
              <div className="flex items-center gap-4 mb-4">
                <div className="w-12 h-12 bg-red-500/20 rounded-xl flex items-center justify-center">
                  <Youtube className="w-6 h-6 text-red-500" />
                </div>
                <div className="flex-1">
                  <div className="font-semibold mb-1">YouTube</div>
                  <div className="text-xs text-zinc-500">YourChannel</div>
                </div>
                {isComplete && (
                  <div className="flex items-center gap-2 text-sm text-emerald-400">
                    <CheckCircle className="w-4 h-4" />
                    Live
                  </div>
                )}
              </div>
              {isUploading && (
                <div className="space-y-2">
                  <div className="flex justify-between text-xs text-zinc-500">
                    <span>Uploading...</span>
                    <span>{Math.round(uploadProgress)}%</span>
                  </div>
                  <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-red-500 to-red-400"
                      style={{ width: `${uploadProgress}%` }}
                    ></div>
                  </div>
                </div>
              )}
              {isComplete && (
                downloadUrl ? (
                  <a
                    href={downloadUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-sm text-blue-400 hover:text-blue-300 underline"
                  >
                    Download video →
                  </a>
                ) : (
                  <span className="text-sm text-zinc-500">Download link unavailable</span>
                )
              )}
            </div>

            {/* Facebook */}
            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6">
              <div className="flex items-center gap-4 mb-4">
                <div className="w-12 h-12 bg-blue-500/20 rounded-xl flex items-center justify-center">
                  <Facebook className="w-6 h-6 text-blue-500" />
                </div>
                <div className="flex-1">
                  <div className="font-semibold mb-1">Facebook</div>
                  <div className="text-xs text-zinc-500">Your Page</div>
                </div>
                {isComplete && (
                  <div className="flex items-center gap-2 text-sm text-emerald-400">
                    <CheckCircle className="w-4 h-4" />
                    Live
                  </div>
                )}
              </div>
              {isUploading && (
                <div className="space-y-2">
                  <div className="flex justify-between text-xs text-zinc-500">
                    <span>Uploading...</span>
                    <span>{Math.round(Math.max(0, uploadProgress - 5))}%</span>
                  </div>
                  <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-blue-500 to-blue-400"
                      style={{ width: `${Math.max(0, uploadProgress - 5)}%` }}
                    ></div>
                  </div>
                </div>
              )}
              {isComplete && (
                <span className="text-sm text-zinc-500">Upload not configured</span>
              )}
            </div>

            {/* Twitter/X */}
            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 opacity-50">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-cyan-500/20 rounded-xl flex items-center justify-center">
                  <Twitter className="w-6 h-6 text-cyan-500" />
                </div>
                <div className="flex-1">
                  <div className="font-semibold mb-1">Twitter / X</div>
                  <div className="text-xs text-zinc-500">Not connected</div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Action buttons */}
        {isComplete && (
          <div className="flex gap-4">
            <button
              onClick={() => navigate(`/editing/editor/${projectId}`)}
              className="flex-1 px-6 py-4 rounded-xl bg-zinc-900 border border-zinc-800 hover:border-zinc-700 transition font-semibold"
            >
              Back to Editor
            </button>
            <button
              onClick={() => navigate('/editing/projects')}
              className="flex-1 px-6 py-4 rounded-xl bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 transition font-semibold"
            >
              Back to Projects
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
