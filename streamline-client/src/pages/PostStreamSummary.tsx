import { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Download, Edit, Home, CheckCircle } from 'lucide-react';
import { editingApi } from '../lib/editingApi';

type Recording = {
  id: string;
  title: string;
  roomName?: string;
  status: 'ready' | 'processing';
  progress: number;
  duration: number;
  viewerCount: number;
  peakViewers: number;
  videoUrl?: string;
  thumbnailUrl?: string;
  createdAt: string;
};

export default function PostStreamSummary() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [recording, setRecording] = useState<Recording | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const recordingId = searchParams.get('recordingId');

  useEffect(() => {
    if (!recordingId) {
      setError('No recording ID provided');
      setLoading(false);
      return;
    }

    const fetchRecording = async () => {
      try {
        const rec = await editingApi.getRecording(recordingId);
        if (rec) {
          setRecording(rec as Recording);
        } else {
          setError('Recording not found');
        }
      } catch (err) {
        console.error('Failed to fetch recording:', err);
        setError('Failed to load recording');
      } finally {
        setLoading(false);
      }
    };

    fetchRecording();
  }, [recordingId]);

  const handleEditClick = () => {
    if (recording) {
      navigate(`/editing/editor/new?recordingId=${recording.id}`);
    }
  };

  const handleDownloadClick = () => {
    if (recording && recording.videoUrl) {
      const a = document.createElement('a');
      a.href = recording.videoUrl;
      a.download = `${recording.title}.mp4`;
      a.click();
    }
  };

  const handleExitClick = () => {
    navigate('/join');
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-purple-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-zinc-400">Loading stream summary...</p>
        </div>
      </div>
    );
  }

  if (!recording) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-400 mb-6">{error || 'Recording not found'}</p>
          <button
            onClick={handleExitClick}
            className="px-6 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 transition"
          >
            Back to Home
          </button>
        </div>
      </div>
    );
  }

  const formatDuration = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    if (hours > 0) {
      return `${hours}h ${minutes}m ${secs}s`;
    }
    return `${minutes}m ${secs}s`;
  };

  return (
    <div className="min-h-screen bg-black text-white flex items-center justify-center p-6">
      <div className="max-w-4xl w-full">
        {/* Header with success icon */}
        <div className="text-center mb-12">
          <div className="w-20 h-20 bg-gradient-to-r from-emerald-500 to-teal-500 rounded-full flex items-center justify-center mx-auto mb-6">
            <CheckCircle className="w-10 h-10" />
          </div>
          <h1 className="text-4xl font-bold mb-3">Stream Complete!</h1>
          <p className="text-zinc-400 text-lg">
            Great session - {recording.peakViewers} viewers watched for {formatDuration(recording.duration)}
          </p>
        </div>

        {/* Recording preview card */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden mb-8">
          <div className="aspect-video bg-gradient-to-br from-zinc-800 to-zinc-900 flex items-center justify-center text-6xl relative overflow-hidden">
            <img
              src={recording.thumbnailUrl}
              alt={recording.title}
              className="w-full h-full object-cover"
              onError={(e) => {
                e.currentTarget.style.display = 'none';
              }}
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent"></div>
            <div className="absolute bottom-4 left-4 right-4">
              <h2 className="text-2xl font-bold mb-1">{recording.title}</h2>
              <div className="flex items-center gap-4 text-sm text-zinc-300">
                <span>Duration: {formatDuration(recording.duration)}</span>
                <span>•</span>
                <span>{recording.peakViewers} viewers</span>
              </div>
            </div>
          </div>
        </div>

        {/* Action buttons */}
        <div className="grid grid-cols-3 gap-4 mb-8">
          {/* Edit Recording */}
          <button
            onClick={handleEditClick}
            className="group relative bg-gradient-to-br from-purple-600/20 to-pink-600/20 border-2 border-purple-500/30 rounded-2xl p-8 hover:scale-105 hover:border-purple-500 transition-all text-left overflow-hidden"
          >
            <div className="absolute inset-0 bg-gradient-to-br from-purple-600/0 to-pink-600/30 opacity-0 group-hover:opacity-100 transition-opacity"></div>
            <div className="relative">
              <div className="w-14 h-14 bg-purple-500/20 rounded-xl flex items-center justify-center mb-4">
                <Edit className="w-7 h-7 text-purple-400" />
              </div>
              <h3 className="text-xl font-bold mb-2">Edit Recording</h3>
              <p className="text-sm text-zinc-400">Cut, trim, and polish your stream</p>
            </div>
          </button>

          {/* Download Recording */}
          <button
            onClick={handleDownloadClick}
            className="group relative bg-gradient-to-br from-blue-600/20 to-cyan-600/20 border-2 border-blue-500/30 rounded-2xl p-8 hover:scale-105 hover:border-blue-500 transition-all text-left overflow-hidden"
          >
            <div className="absolute inset-0 bg-gradient-to-br from-blue-600/0 to-cyan-600/30 opacity-0 group-hover:opacity-100 transition-opacity"></div>
            <div className="relative">
              <div className="w-14 h-14 bg-blue-500/20 rounded-xl flex items-center justify-center mb-4">
                <Download className="w-7 h-7 text-blue-400" />
              </div>
              <h3 className="text-xl font-bold mb-2">Download Now</h3>
              <p className="text-sm text-zinc-400">Get the raw recording</p>
            </div>
          </button>

          {/* Exit */}
          <button
            onClick={handleExitClick}
            className="group relative bg-zinc-900 border-2 border-zinc-800 rounded-2xl p-8 hover:scale-105 hover:border-zinc-700 transition-all text-left overflow-hidden"
          >
            <div className="relative">
              <div className="w-14 h-14 bg-zinc-800 rounded-xl flex items-center justify-center mb-4">
                <Home className="w-7 h-7 text-zinc-400" />
              </div>
              <h3 className="text-xl font-bold mb-2">Exit</h3>
              <p className="text-sm text-zinc-400">Leave without saving</p>
            </div>
          </button>
        </div>

        {/* Stream stats */}
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6">
          <div className="grid grid-cols-3 gap-6 text-center">
            <div>
              <div className="text-2xl font-bold text-emerald-400">{recording.peakViewers}</div>
              <div className="text-xs text-zinc-500 mt-1">Peak Viewers</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-blue-400">{formatDuration(recording.duration)}</div>
              <div className="text-xs text-zinc-500 mt-1">Stream Length</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-purple-400">{new Date(recording.createdAt).toLocaleDateString()}</div>
              <div className="text-xs text-zinc-500 mt-1">Date</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
