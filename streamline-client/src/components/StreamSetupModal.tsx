import { useState } from "react";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onStart: (keys: { 
    youtubeKey?: string; 
    facebookKey?: string;
  }) => Promise<void>;
  onStop: () => Promise<void>;
  status: string;
}

export default function StreamSetupModal({
  isOpen,
  onClose,
  onStart,
  onStop,
  status,
}: Props) {
  const [useYouTube, setUseYouTube] = useState(true);
  const [useFacebook, setUseFacebook] = useState(false);

  const [youtubeKey, setYoutubeKey] = useState("");
  const [facebookKey, setFacebookKey] = useState("");

  if (!isOpen) return null;

  const isLive = status === "live";
  const isBusy =
    status === "starting" || status === "stopping";

  const handleStart = async () => {
    const yt = useYouTube ? youtubeKey.trim() : "";
    const fb = useFacebook ? facebookKey.trim() : "";

    if (!yt && !fb) {
      alert("Enter at least one stream key (YouTube or Facebook).");
      return;
    }

    await onStart({
      youtubeKey: yt || undefined,
      facebookKey: fb || undefined,
    });
  };

  const handleStop = async () => {
    await onStop();
  };

  return (
    <div
      className="fixed inset-0 flex items-center justify-center bg-black/60 z-50"
      style={{ backdropFilter: "blur(3px)" }}
    >
      <div className="bg-[#111] text-white rounded-lg p-4 w-full max-w-md shadow-lg border border-white/10">
        <div className="flex justify-between items-center mb-3">
          <h2 className="text-lg font-semibold">Setup Stream</h2>
          <button onClick={onClose} disabled={isBusy} className="text-sm">
            ✕
          </button>
        </div>

        <p className="text-xs text-neutral-400 mb-3">
          Paste your <strong>stream keys</strong> for any platform you want to
          stream to. No logins are saved.
        </p>

        <div className="space-y-3">

          {/* YouTube */}
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={useYouTube}
              onChange={() => setUseYouTube(v => !v)}
            />
            <div className="flex-1">
              <div className="font-medium">YouTube Live</div>
              <input
                type="text"
                value={youtubeKey}
                onChange={(e) => setYoutubeKey(e.target.value)}
                placeholder="YouTube Stream Key"
                disabled={!useYouTube || isBusy || isLive}
                className="mt-1 w-full bg-black/40 border border-white/15 rounded px-2 py-1 text-xs"
              />
            </div>
          </label>

          {/* Facebook */}
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={useFacebook}
              onChange={() => setUseFacebook(v => !v)}
            />
            <div className="flex-1">
              <div className="font-medium">Facebook Live</div>
              <input
                type="text"
                value={facebookKey}
                onChange={(e) => setFacebookKey(e.target.value)}
                placeholder="Facebook Stream Key"
                disabled={!useFacebook || isBusy || isLive}
                className="mt-1 w-full bg-black/40 border border-white/15 rounded px-2 py-1 text-xs"
              />
            </div>
          </label>

        </div>

        <div className="mt-4 flex justify-between items-center">
          <div className="text-xs text-neutral-400">
            Status:{" "}
            <span className="font-semibold text-white">
              {(status || "").toUpperCase()}
            </span>
          </div>

         {!isLive ? (
  <button
    onClick={handleStart}
    disabled={isBusy}
    className="px-3 py-1 text-xs rounded bg-green-600 disabled:bg-green-900"
  >
    {(status as string) === "starting" ? "Starting…" : "Go Live"}
  </button>
) : (
  <button
    onClick={handleStop}
    disabled={isBusy}
    className="px-3 py-1 text-xs rounded bg-red-600 disabled:bg-red-900"
  >
    {(status as string) === "stopping" ? "Stopping…" : "Stop Stream"}
  </button>
)}

        </div>
      </div>
    </div>
  );
}
