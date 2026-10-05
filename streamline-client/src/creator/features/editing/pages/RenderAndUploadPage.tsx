import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { CheckCircle, XCircle, AlertCircle, Zap } from 'lucide-react';
import {
  editingApi,
  type ExportFormat,
  type ExportJob,
  type ExportOptions,
  type ExportQuality,
  type ExportResolution,
  type ExportSettings,
  EXPORT_TERMINAL_STATUSES,
} from '../../../../lib/editingApi';
import { getProject, type Project } from '../../../../lib/projectsApi';

const SETTINGS_KEY = 'sl_export_settings_v1';

const RES_LABEL: Record<ExportResolution, string> = { '720p': '720p', '1080p': '1080p', '4k': '4K' };
const QUALITY_LABEL: Record<ExportQuality, string> = { draft: 'Draft (fast, smaller)', standard: 'Standard', high: 'High (slower, larger)' };
const FORMAT_LABEL: Record<ExportFormat, string> = { mp4: 'MP4 (H.264)', webm: 'WebM (VP9)', mov: 'MOV (H.264)' };

const FALLBACK_OPTIONS: ExportOptions = {
  resolutions: ['720p', '1080p'],
  maxResolution: null,
  formats: ['mp4', 'webm', 'mov'],
  qualities: ['draft', 'standard', 'high'],
  fpsOptions: [24, 30, 60],
  exportsUsed: 0,
  exportsLimit: null,
  priority: false,
};

function readSavedSettings(): Partial<ExportSettings> {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? (JSON.parse(raw) as Partial<ExportSettings>) : {};
  } catch {
    return {};
  }
}

/** Saved choice clamped to what the plan allows; default = best allowed up to 1080p. */
function initialSettings(opts: ExportOptions): ExportSettings {
  const saved = readSavedSettings();
  const preferred: ExportResolution = opts.resolutions.includes('1080p') ? '1080p' : opts.resolutions[opts.resolutions.length - 1] || '720p';
  return {
    resolution: saved.resolution && opts.resolutions.includes(saved.resolution) ? saved.resolution : preferred,
    format: saved.format && opts.formats.includes(saved.format) ? saved.format : 'mp4',
    quality: saved.quality && opts.qualities.includes(saved.quality) ? saved.quality : 'standard',
    fps: saved.fps && opts.fpsOptions.includes(saved.fps) ? saved.fps : 30,
  };
}

export default function RenderAndUploadPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const [project, setProject] = useState<Project | null>(null);
  const [exportJob, setExportJob] = useState<ExportJob | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [library, setLibrary] = useState<{ state: 'idle' | 'saving' | 'saved' | 'error'; message?: string }>({ state: 'idle' });
  const [options, setOptions] = useState<ExportOptions | null>(null);
  const [settings, setSettings] = useState<ExportSettings | null>(null);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const cancelledRef = useRef(false);

  // Load the project and what the plan allows; the export starts on click.
  useEffect(() => {
    cancelledRef.current = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      setExportJob(null);
      if (!projectId) {
        setLoading(false);
        return;
      }
      const [proj, opts] = await Promise.all([
        getProject(projectId).catch(() => null),
        editingApi.getExportOptions().catch((e: unknown) => {
          if (!cancelledRef.current) setStartError(e instanceof Error ? e.message : String(e));
          return null;
        }),
      ]);
      if (cancelledRef.current) return;
      setProject(proj);
      const effective = opts || FALLBACK_OPTIONS;
      setOptions(effective);
      setSettings(initialSettings(effective));
      setLoading(false);
    };
    void load();
    return () => {
      cancelledRef.current = true;
    };
  }, [projectId]);

  const updateSettings = (patch: Partial<ExportSettings>) => {
    setSettings((prev) => {
      const next = { ...(prev as ExportSettings), ...patch };
      try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  };

  const startExport = async () => {
    if (!projectId || !settings) return;
    setStarting(true);
    setStartError(null);
    setError(null);
    let started: ExportJob | null = null;
    try {
      started = await editingApi.startExport(projectId, settings);
      if (cancelledRef.current) return;
      setExportJob(started);
      setOptions((o) => (o ? { ...o, exportsUsed: o.exportsUsed + 1 } : o));
      if (EXPORT_TERMINAL_STATUSES.includes(started.status)) return;
      const finalJob = await editingApi.waitForExport(started.id, (job) => {
        if (!cancelledRef.current) setExportJob(job);
      });
      if (!cancelledRef.current) setExportJob(finalJob);
    } catch (e: unknown) {
      if (cancelledRef.current) return;
      const message = e instanceof Error ? e.message : String(e);
      if (!started) {
        // Refused before a job existed (plan limit, resolution, empty timeline): stay on the settings card.
        setStartError(message);
      } else {
        setError(message);
        setExportJob((prev) =>
          prev ? { ...prev, status: prev.status === 'canceled' ? 'canceled' : 'failed', error: prev.error || message } : prev,
        );
      }
    } finally {
      if (!cancelledRef.current) setStarting(false);
    }
  };

  const progress = exportJob?.progressPercent ?? exportJob?.progress ?? 0;
  const currentStep = exportJob?.currentStep || '';
  const status = exportJob?.status || '';
  const downloadUrl = exportJob?.outputUrl || exportJob?.downloadUrl || null;
  const isTerminal = EXPORT_TERMINAL_STATUSES.includes(status as ExportJob["status"]);
  const isSuccess = status === 'completed';
  const isFailed = status === 'failed';
  const isCanceled = status === 'canceled';

  const handleSaveToLibrary = async () => {
    if (!exportJob?.id) return;
    setLibrary({ state: 'saving' });
    try {
      await editingApi.saveExportToLibrary(exportJob.id, project?.name);
      setLibrary({ state: 'saved' });
      setExportJob((prev) => prev ? { ...prev, outputUrl: undefined, downloadUrl: undefined } : prev);
    } catch (e: unknown) {
      setLibrary({ state: 'error', message: e instanceof Error ? e.message : 'Could not save to library' });
    }
  };

  const savedToLibrary = library.state === 'saved' || !!exportJob?.savedVideoId;

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
          <p className="text-zinc-400">Loading export settings...</p>
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
            onClick={() => navigate('/projects')}
            className="px-6 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 transition"
          >
            Back to Projects
          </button>
        </div>
      </div>
    );
  }

  if (!exportJob && options && settings) {
    const limitReached = options.exportsLimit !== null && options.exportsUsed >= options.exportsLimit;
    const pill = (active: boolean, disabled = false) =>
      `px-4 py-2 rounded-lg text-sm font-semibold border transition ${
        disabled
          ? 'border-zinc-800 text-zinc-600 cursor-not-allowed'
          : active
            ? 'border-purple-500 bg-purple-600/20 text-white'
            : 'border-zinc-700 text-zinc-300 hover:border-zinc-500'
      }`;
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center p-6">
        <div className="max-w-xl w-full bg-zinc-900 border border-zinc-800 rounded-2xl p-8" data-testid="export-settings">
          <h1 className="text-2xl font-bold mb-1">Export settings</h1>
          <p className="text-zinc-400 text-sm mb-6">{project.name}</p>

          <div className="mb-5">
            <div className="text-xs uppercase tracking-wide text-zinc-500 mb-2">Resolution</div>
            <div className="flex gap-2 flex-wrap">
              {(['720p', '1080p', '4k'] as ExportResolution[]).map((r) => {
                const allowed = options.resolutions.includes(r);
                return (
                  <button
                    key={r}
                    type="button"
                    disabled={!allowed}
                    onClick={() => updateSettings({ resolution: r })}
                    className={pill(settings.resolution === r, !allowed)}
                    title={allowed ? undefined : 'Not included in your plan'}
                  >
                    {RES_LABEL[r]}
                  </button>
                );
              })}
            </div>
            {options.maxResolution && options.maxResolution !== '4k' && (
              <p className="text-xs text-zinc-500 mt-2">Your plan exports up to {RES_LABEL[options.maxResolution]}. Upgrade for higher resolutions.</p>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
            <label className="text-xs uppercase tracking-wide text-zinc-500">
              Format
              <select
                value={settings.format}
                onChange={(e) => updateSettings({ format: e.target.value as ExportFormat })}
                className="mt-2 w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white normal-case tracking-normal"
              >
                {options.formats.map((f) => (
                  <option key={f} value={f}>{FORMAT_LABEL[f]}</option>
                ))}
              </select>
            </label>
            <label className="text-xs uppercase tracking-wide text-zinc-500">
              Quality
              <select
                value={settings.quality}
                onChange={(e) => updateSettings({ quality: e.target.value as ExportQuality })}
                className="mt-2 w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white normal-case tracking-normal"
              >
                {options.qualities.map((q) => (
                  <option key={q} value={q}>{QUALITY_LABEL[q]}</option>
                ))}
              </select>
            </label>
            <label className="text-xs uppercase tracking-wide text-zinc-500">
              Frame rate
              <select
                value={settings.fps}
                onChange={(e) => updateSettings({ fps: Number(e.target.value) as ExportSettings['fps'] })}
                className="mt-2 w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white normal-case tracking-normal"
              >
                {options.fpsOptions.map((f) => (
                  <option key={f} value={f}>{f} fps</option>
                ))}
              </select>
            </label>
          </div>

          <div className="flex items-center justify-between text-sm text-zinc-400 mb-6">
            <span data-testid="export-usage">
              Exports this month:{' '}
              <span className="text-white font-semibold">
                {options.exportsLimit === null ? `${options.exportsUsed} (unlimited)` : `${options.exportsUsed} / ${options.exportsLimit}`}
              </span>
            </span>
            {options.priority && (
              <span className="flex items-center gap-1 text-amber-300">
                <Zap className="w-4 h-4" /> Priority rendering
              </span>
            )}
          </div>

          {(startError || limitReached) && (
            <div className="bg-red-950/30 border border-red-500/30 rounded-xl p-3 mb-4 text-sm text-red-300" role="alert">
              {startError || "You've used all your exports for this month."}
            </div>
          )}

          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => navigate(`/editing/editor/${projectId}`)}
              className="flex-1 px-6 py-3 rounded-xl bg-zinc-800 hover:bg-zinc-700 transition font-semibold"
            >
              Back to Editor
            </button>
            <button
              type="button"
              onClick={() => void startExport()}
              disabled={starting || limitReached}
              data-testid="start-export"
              className="flex-1 px-6 py-3 rounded-xl bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 disabled:opacity-40 transition font-semibold"
            >
              {starting ? 'Starting…' : 'Start export'}
            </button>
          </div>
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

        {/* Save to library: keeps the export as a saved video (download links expire) */}
        {isSuccess && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 mb-6">
            {savedToLibrary ? (
              <div className="flex items-center justify-between gap-4">
                <span className="text-sm text-emerald-300">Saved to your content library.</span>
                <button
                  onClick={() => navigate('/content')}
                  className="text-sm text-blue-400 hover:text-blue-300 underline"
                >
                  Open library →
                </button>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-4">
                <span className="text-sm text-zinc-400">
                  Export downloads expire. Save it to keep the video in your library.
                </span>
                <button
                  onClick={handleSaveToLibrary}
                  disabled={library.state === 'saving' || exportJob?.outputExpired}
                  className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-sm font-semibold whitespace-nowrap"
                >
                  {library.state === 'saving' ? 'Saving…' : 'Save to library'}
                </button>
              </div>
            )}
            {library.state === 'error' && <p className="text-xs text-red-300 mt-2">{library.message}</p>}
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
                onClick={() => {
                  setExportJob(null);
                  setError(null);
                  setLibrary({ state: 'idle' });
                }}
                className="flex-1 px-6 py-4 rounded-xl bg-gradient-to-r from-orange-600 to-red-600 hover:from-orange-500 hover:to-red-500 transition font-semibold"
              >
                Retry Export
              </button>
            )}
            <button
              onClick={() => navigate('/projects')}
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
