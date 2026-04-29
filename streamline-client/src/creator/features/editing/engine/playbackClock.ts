// ============================================================================
// PLAYBACK CLOCK — requestAnimationFrame-based playback timer
// ============================================================================

export type PlaybackClockCallbacks = {
  getPlayheadTime: () => number;
  getTotalDuration: () => number;
  setPlayheadTime: (time: number) => void;
  setIsPlaying: (playing: boolean) => void;
};

let animationFrameId: number | null = null;
let startWallTime: number = 0;
let startPlayhead: number = 0;

export function startPlaybackClock(callbacks: PlaybackClockCallbacks) {
  stopPlaybackClock();
  
  startWallTime = performance.now();
  startPlayhead = callbacks.getPlayheadTime();

  const tick = (now: number) => {
    const elapsed = (now - startWallTime) / 1000;
    const newTime = startPlayhead + elapsed;
    const duration = callbacks.getTotalDuration();

    if (newTime >= duration) {
      callbacks.setPlayheadTime(duration);
      callbacks.setIsPlaying(false);
      animationFrameId = null;
      return;
    }

    callbacks.setPlayheadTime(newTime);
    animationFrameId = requestAnimationFrame(tick);
  };

  animationFrameId = requestAnimationFrame(tick);
}

export function stopPlaybackClock() {
  if (animationFrameId !== null) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }
}

export function isClockRunning(): boolean {
  return animationFrameId !== null;
}
