// ============================================================================
// VIDEO PREVIEW — Timeline-driven preview with video element pool
// ============================================================================

import { useEffect, useRef, useCallback } from 'react';
import { useEditorStore } from '../store/editorStore';
import { resolvePlayback } from '../engine/playbackResolver';

export default function VideoPreview() {
  const clips = useEditorStore(s => s.clips);
  const tracks = useEditorStore(s => s.tracks);
  const playheadTime = useEditorStore(s => s.playheadTime);
  const isPlaying = useEditorStore(s => s.isPlaying);
  const assets = useEditorStore(s => s.assets);

  // Video element pool (2 elements for cross-fade-free clip switching)
  const videoARef = useRef<HTMLVideoElement>(null);
  const videoBRef = useRef<HTMLVideoElement>(null);
  const activeSlot = useRef<'A' | 'B'>('A');
  const currentClipId = useRef<string | null>(null);

  // Audio elements for up to 4 simultaneous audio clips
  const audioRefs = useRef<HTMLAudioElement[]>([]);
  const activeAudioClipIds = useRef<Set<string>>(new Set());

  // Ensure audio elements exist
  useEffect(() => {
    if (audioRefs.current.length === 0) {
      for (let i = 0; i < 4; i++) {
        const el = document.createElement('audio');
        el.preload = 'auto';
        audioRefs.current.push(el);
      }
    }
    return () => {
      audioRefs.current.forEach(el => { el.pause(); el.src = ''; });
    };
  }, []);

  const getActiveVideo = useCallback((): HTMLVideoElement | null => {
    return activeSlot.current === 'A' ? videoARef.current : videoBRef.current;
  }, []);

  const getInactiveVideo = useCallback((): HTMLVideoElement | null => {
    return activeSlot.current === 'A' ? videoBRef.current : videoARef.current;
  }, []);

  // Resolve playback state and sync video/audio elements
  useEffect(() => {
    const pb = resolvePlayback(playheadTime, clips, tracks);

    // --- Video sync ---
    if (pb.activeVideoClip && pb.videoSourceTime !== null) {
      const asset = assets.get(pb.activeVideoClip.assetId);
      const url = asset?.url || '';

      if (pb.activeVideoClip.id !== currentClipId.current) {
        // Clip changed — switch to inactive slot
        const next = getInactiveVideo();
        const prev = getActiveVideo();

        if (next && url) {
          if (next.src !== url) {
            next.src = url;
            next.load();
          }
          next.currentTime = pb.videoSourceTime;
          next.style.display = 'block';
          if (isPlaying) next.play().catch(() => {});

          if (prev) {
            prev.style.display = 'none';
            prev.pause();
          }

          activeSlot.current = activeSlot.current === 'A' ? 'B' : 'A';
        }
        currentClipId.current = pb.activeVideoClip.id;
      } else {
        // Same clip — just sync time
        const active = getActiveVideo();
        if (active) {
          if (active.src !== url && url) {
            active.src = url;
            active.load();
          }
          const drift = Math.abs(active.currentTime - pb.videoSourceTime);
          if (drift > 0.3 || !isPlaying) {
            active.currentTime = pb.videoSourceTime;
          }
          if (isPlaying && active.paused) active.play().catch(() => {});
          if (!isPlaying && !active.paused) active.pause();
        }
      }
    } else {
      // No active video — show black / pause both
      const a = videoARef.current;
      const b = videoBRef.current;
      if (a) { a.pause(); a.style.display = 'none'; }
      if (b) { b.pause(); b.style.display = 'none'; }
      currentClipId.current = null;
    }

    // --- Audio sync ---
    const newAudioIds = new Set(pb.activeAudioClips.map(c => c.id));

    // Stop audio for clips no longer active
    const toStop = [...activeAudioClipIds.current].filter(id => !newAudioIds.has(id));
    for (const id of toStop) {
      const idx = [...activeAudioClipIds.current].indexOf(id);
      if (idx >= 0 && idx < audioRefs.current.length) {
        audioRefs.current[idx].pause();
      }
    }

    // Sync active audio clips
    pb.activeAudioClips.forEach((clip, i) => {
      if (i >= audioRefs.current.length) return;
      const el = audioRefs.current[i];
      const asset = assets.get(clip.assetId);
      const url = asset?.url || '';
      const sourceTime = pb.audioSourceTimes.get(clip.id) ?? 0;

      if (el.src !== url && url) {
        el.src = url;
        el.load();
      }
      el.volume = clip.isMuted ? 0 : clip.volume;
      const drift = Math.abs(el.currentTime - sourceTime);
      if (drift > 0.3 || !isPlaying) {
        el.currentTime = sourceTime;
      }
      if (isPlaying && el.paused && url) el.play().catch(() => {});
      if (!isPlaying && !el.paused) el.pause();
    });

    activeAudioClipIds.current = newAudioIds;
  }, [playheadTime, clips, tracks, isPlaying, assets, getActiveVideo, getInactiveVideo]);

  // Pause all on unmount
  useEffect(() => {
    return () => {
      videoARef.current?.pause();
      videoBRef.current?.pause();
      audioRefs.current.forEach(el => el.pause());
    };
  }, []);

  const hasClips = clips.length > 0;

  return (
    <div className="bg-black flex items-center justify-center relative" style={{ maxHeight: '45vh', minHeight: '120px', aspectRatio: '16/9' }}>
      {hasClips ? (
        <>
          <video
            ref={videoARef}
            className="max-h-full max-w-full object-contain rounded"
            style={{ position: 'absolute', inset: 0, margin: 'auto', maxHeight: '100%', maxWidth: '100%' }}
            playsInline
            muted
          />
          <video
            ref={videoBRef}
            className="max-h-full max-w-full object-contain rounded"
            style={{ position: 'absolute', inset: 0, margin: 'auto', maxHeight: '100%', maxWidth: '100%', display: 'none' }}
            playsInline
            muted
          />
          {/* Black overlay when no video clip is active */}
          {resolvePlayback(playheadTime, clips, tracks).isBlack && (
            <div className="absolute inset-0 bg-black flex items-center justify-center">
              <span className="text-zinc-600 text-sm">No video at playhead</span>
            </div>
          )}
        </>
      ) : (
        <div className="text-zinc-600 text-center py-12">
          <div className="text-5xl mb-3 opacity-50">🎬</div>
          <p className="text-sm">Add media to begin editing</p>
          <p className="text-xs text-zinc-700 mt-1">Drag from assets or click + to add</p>
        </div>
      )}
    </div>
  );
}
