import { useNavigate } from "react-router-dom";

type RecordingToastProps = {
  message: string;
  type: "success" | "error" | "info";
  onDismiss: () => void;
  /** Optional: navigate to recordings page on click */
  recordingsPath?: string;
};

/**
 * Floating toast that appears when a recording finishes processing.
 * Rendered inside a room/broadcast page to notify the user.
 */
export default function RecordingToast({ message, type, onDismiss, recordingsPath }: RecordingToastProps) {
  const nav = useNavigate();

  const borderColor =
    type === "success"
      ? "border-emerald-500/40"
      : type === "error"
        ? "border-red-500/40"
        : "border-blue-500/40";

  const bgColor =
    type === "success"
      ? "bg-emerald-500/15"
      : type === "error"
        ? "bg-red-500/15"
        : "bg-blue-500/15";

  const textColor =
    type === "success"
      ? "text-emerald-300"
      : type === "error"
        ? "text-red-300"
        : "text-blue-300";

  return (
    <div
      className={`fixed bottom-6 right-6 z-50 flex items-center gap-3 rounded-xl border ${borderColor} ${bgColor} px-4 py-3 shadow-lg backdrop-blur-sm animate-in slide-in-from-bottom-4 duration-300`}
      style={{ maxWidth: 420 }}
    >
      <span className={`text-sm font-medium ${textColor}`}>{message}</span>
      <div className="flex items-center gap-2">
        {type === "success" && recordingsPath && (
          <button
            onClick={() => {
              onDismiss();
              nav(recordingsPath);
            }}
            className="whitespace-nowrap rounded-lg bg-emerald-500/20 px-3 py-1 text-xs font-semibold text-emerald-300 transition hover:bg-emerald-500/30"
          >
            View Recordings
          </button>
        )}
        <button
          onClick={onDismiss}
          className="rounded-lg px-2 py-1 text-xs text-slate-400 transition hover:text-white"
          aria-label="Dismiss"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
