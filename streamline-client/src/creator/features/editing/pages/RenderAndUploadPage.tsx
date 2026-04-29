import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { CheckCircle, XCircle, AlertCircle } from 'lucide-react';
import { editingApi, type Project, type ExportJob, EXPORT_TERMINAL_STATUSES } from '../../../../lib/editingApi';

export default function RenderAndUploadPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const [project, setProject] = useState<Project | null>(null);
  const [exportJob, setExportJob] = useState<ExportJob | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;

    const start = async () => {
      setLoading(true);
      setError(null);
      setExportJob(null);

      if (!projectId) {
        setLoading(false);
        return;
      }

      try {
        const proj = await editingApi.getProject(projectId);
        if (cancelledRef.current) return;
        if (!proj) {
          setProject(null);
          setLoading(false);
          return;
        }
        setProject(proj as Project);

        // Start the export job
        const started = await editingApi.startExport(
          projectId,
          { format: 'mp4', resolution: '1080p', quality: 'standard' }
        );

        if (cancelledRef.current) return;
        setExportJob(started);
        setLoading(false);

        // If already terminal, stop
        if (EXPORT_TERMINAL_STATUSES.includes(started.status)) return;

        // Poll for updates
        const finalJob = await editingApi.waitForExport(started.id, (job) => {
          if (!cancelledRef.current) setExportJob(job);
        });

        if (!cancelledRef.current) setExportJob(finalJob);
      } catch (e: any) {
        if (cancelledRef.current) return;
        setError(e?.message || String(e));
        setLoading(false);
      }
    };

    start();

    return () => {
      cancelledRef.current = true;
    };
  }, [projectId]);

  const progress = exportJob?.progressPercent ?? exportJob?.progress ?? 0;
  const currentStep = exportJob?.currentStep || '';
  const status = exportJob?.status || '';
  const downloadUrl = exportJob?.outputUrl || exportJob?.downloadUrl || null;
  const isTerminal = EXPORT_TERMINAL_STATUSES.includes(status as ExportJob["status"]);
  const isSuccess = status === 'completed';
  const isFailed = status === 'failed';
  const isCanceled = status === 'canceled';

  const handleCancel = async () => {
    if (!exportJob?.id) return;
    try {
      await editingApi.cancelExport(exportJob.id);
      setExportJob((prev) => prev ? { ...prev, status: 'canceled', currentStep: 'Canceled' } : prev);
    } catch {
      // ignore
    }
  };

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
              <XCircle className="w-12 h-12 text-red-400 mx-auto mb-4" />
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

  return (
    <div className="min-h-screen bg-black text-white flex items-center justify-center p-6">
      <div className="max-w-2xl w-full">
        {/* Header */}
        <div className="text-center mb-10">
          {!isTerminal && (
            <>
              <div className="w-20 h-20 border-4 border-purple-500 border-t-transparent rounded-full animate-spin mx-auto mb-6"></div>
              <h1 className="text-3xl font-bold mb-2">Exporting Video</h1>
              <p className="text-zinc-400">Processing {project.name}...</p>
            </>
          )}
          {isSuccess && (
            <>
              <div className="w-20 h-20 bg-gradient-to-r from-emerald-500 to-teal-500 rounded-full flex items-center justify-center mx-auto mb-6">
                <CheckCircle className="w-10 h-10" />
              </div>
              <h1 className="text-3xl font-bold mb-2">Export Complete</h1>
              <p className="text-zinc-400">Your video is ready to download</p>
            </>
          )}
          {isFailed && (
            <>
              <div className="w-20 h-20 bg-gradient-to-r from-red-500 to-rose-500 rounded-full flex items-center justify-center mx-auto mb-6">
                <XCircle className="w-10 h-10" />
              </div>
              <h1 className="text-3xl font-bold mb-2">Export Failed</h1>
              <p className="text-zinc-400">{exportJob?.error || error || 'Something went wrong'}</p>
            </>
          )}
          {isCanceled && (
            <>
              <div className="w-20 h-20 bg-zinc-700 rounded-full flex items-center justify-center mx-auto mb-6">
                <AlertCircle className="w-10 h-10 text-zinc-400" />
              </div>
              <h1 className="text-3xl font-bold mb-2">Export Canceled</h1>
              <p className="text-zinc-400">The export was canceled</p>
            </>
          )}
        </div>

        {/* Progress */}
        {!isTerminal && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-8 mb-6">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-medium capitalize">{currentStep || status}</span>
              <span className="text-sm text-purple-400 font-mono">{Math.round(progress)}%</span>
            </div>
            <div className="h-3 bg-zinc-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-purple-500 to-pink-500 transition-all duration-500"
                style={{ width: `${progress}%` }}
              ></div>
            </div>
            <div className="mt-4 flex items-center justify-between text-xs text-zinc-500">
              <span>
                {status === 'queued' && 'Waiting in queue...'}
                {status === 'preparing' && 'Downloading source assets...'}
                {status === 'rendering' && 'Processing with FFmpeg'}
                {status === 'uploading' && 'Uploading rendered file...'}
              </span>
              <button
                onClick={handleCancel}
                className="text-red-400 hover:text-red-300 transition"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Job info */}
        {exportJob && (
          <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-4 mb-6 text-xs text-zinc-500 space-y-1">
            <p>Job ID: <span className="text-zinc-300 font-mono">{exportJob.id}</span></p>
            <p>Status: <span className={`font-medium ${isSuccess ? 'text-emerald-400' : isFailed ? 'text-red-400' : 'text-zinc-300'}`}>{status}</span></p>
            {exportJob.attemptCount != null && exportJob.attemptCount > 1 && (
              <p>Attempts: {exportJob.attemptCount}</p>
            )}
          </div>
        )}

        {/* Download section */}
        {isSuccess && downloadUrl && (
          <div className="bg-zinc-900 border border-emerald-500/30 rounded-2xl p-6 mb-6">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-emerald-500/20 rounded-xl flex items-center justify-center">
                <CheckCircle className="w-6 h-6 text-emerald-400" />
              </div>
              <div className="flex-1">
                <div className="font-semibold mb-1">Your video is ready</div>
                <a
                  href={downloadUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sm text-blue-400 hover:text-blue-300 underline"
                >
                  Download video →
                </a>
              </div>
            </div>
          </div>
        )}

        {/* Error detail */}
        {isFailed && error && (
          <div className="bg-red-950/30 border border-red-500/30 rounded-xl p-4 mb-6">
            <p className="text-sm text-red-300">{error}</p>
          </div>
        )}

        {/* Action buttons */}
        {isTerminal && (
          <div className="flex gap-4">
            <button
              onClick={() => navigate(`/editing/editor/${projectId}`)}
              className="flex-1 px-6 py-4 rounded-xl bg-zinc-900 border border-zinc-800 hover:border-zinc-700 transition font-semibold"
            >
              Back to Editor
            </button>
            {isFailed && (
              <button
                onClick={() => window.location.reload()}
                className="flex-1 px-6 py-4 rounded-xl bg-gradient-to-r from-orange-600 to-red-600 hover:from-orange-500 hover:to-red-500 transition font-semibold"
              >
                Retry Export
              </button>
            )}
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
