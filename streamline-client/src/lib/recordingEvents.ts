/**
 * Recording Lifecycle Event Bus
 *
 * Global event emitter for recording state changes.
 * Components subscribe anywhere in the tree; events fire globally.
 *
 * Events:
 *   recording.processing — recording has stopped, asset is being processed
 *   recording.ready      — recording/render is done, asset is downloadable
 *   recording.failed     — something went wrong
 */

export type RecordingEventType =
  | "recording.processing"
  | "recording.ready"
  | "recording.failed";

export interface RecordingLifecycleEvent {
  type: RecordingEventType;
  projectId?: string;
  assetId?: string;
  recordingId?: string;
  message?: string;
  downloadUrl?: string;
}

type Listener = (evt: RecordingLifecycleEvent) => void;

const listeners = new Map<RecordingEventType, Set<Listener>>();

function getSet(type: RecordingEventType): Set<Listener> {
  let s = listeners.get(type);
  if (!s) {
    s = new Set();
    listeners.set(type, s);
  }
  return s;
}

export const recordingEvents = {
  /** Subscribe to a lifecycle event. Returns an unsubscribe function. */
  on(type: RecordingEventType, fn: Listener): () => void {
    getSet(type).add(fn);
    return () => {
      getSet(type).delete(fn);
    };
  },

  /** Emit a lifecycle event to all subscribers. */
  emit(evt: RecordingLifecycleEvent) {
    const s = listeners.get(evt.type);
    if (s) {
      s.forEach((fn) => {
        try {
          fn(evt);
        } catch (e) {
          console.error("[recordingEvents] listener error:", e);
        }
      });
    }
  },
};
