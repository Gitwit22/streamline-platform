/**
 * useMixedAudioPublish — feature-flagged hook for publishing the mixer's
 * program audio track via LiveKit instead of the raw microphone track.
 *
 * **Experimental / opt-in**: only activates when the platform flag
 * `mixedAudioPublishEnabled` is truthy AND the caller sets `enabled: true`.
 *
 * What it does:
 *   1. Mutes the local mic publication (so viewers don't hear raw mic twice)
 *   2. Publishes the mixer's program audio track as a secondary audio track
 *   3. On cleanup: unpublishes the mixed track and unmutes the original mic
 *
 * Safety:
 *   - No-ops silently when the flag is off or the mixer isn't initialised
 *   - Cleans up automatically on unmount or when disabled
 *   - Does NOT replace the default LiveKit audio path unless explicitly activated
 */

import { useEffect, useRef, useCallback, useState } from "react";
import { useRoomContext } from "@livekit/components-react";
import { Track, type LocalTrackPublication } from "livekit-client";
import { getMixer } from "../components/AudioMixerModal";
import { usePlatformFlags } from "../../hooks/usePlatformFlags";

export type MixedPublishState = "off" | "activating" | "active" | "error";

export function useMixedAudioPublish(opts: { enabled: boolean }) {
  const { flags } = usePlatformFlags();
  const room = useRoomContext();
  const [state, setState] = useState<MixedPublishState>("off");
  const [error, setError] = useState<string | null>(null);

  // Refs to track what we've published so we can clean up
  const mixedPubRef = useRef<LocalTrackPublication | null>(null);
  const originalMicMutedRef = useRef(false);
  const activeRef = useRef(false);

  const flagEnabled = !!(flags as any)?.mixedAudioPublishEnabled;
  const shouldBeActive = opts.enabled && flagEnabled;

  const activate = useCallback(async () => {
    if (activeRef.current) return;
    activeRef.current = true;
    setState("activating");
    setError(null);

    try {
      const mixer = getMixer();
      const programTrack = mixer.getProgramAudioTrack();
      if (!programTrack) {
        throw new Error("Mixer program audio track not available. Open the mixer first.");
      }

      const lp = room.localParticipant;

      // Step 1: Mute original mic publication so viewers don't get double audio
      const micPubs = Array.from(lp.audioTrackPublications.values()).filter(
        (p) => p.source === Track.Source.Microphone,
      );
      for (const pub of micPubs) {
        if (!pub.isMuted) {
          await pub.mute();
          originalMicMutedRef.current = true;
        }
      }

      // Step 2: Publish the mixed program audio track
      const pub = await lp.publishTrack(programTrack, {
        name: "mixed-program-audio",
        source: Track.Source.Unknown,
      });
      mixedPubRef.current = pub;
      setState("active");
    } catch (err: any) {
      setError(err?.message ?? "Failed to publish mixed audio");
      setState("error");
      activeRef.current = false;
    }
  }, [room]);

  const deactivate = useCallback(async () => {
    if (!activeRef.current) return;
    activeRef.current = false;

    try {
      const lp = room.localParticipant;

      // Unpublish the mixed track
      if (mixedPubRef.current?.track) {
        await lp.unpublishTrack(mixedPubRef.current.track);
        mixedPubRef.current = null;
      }

      // Unmute original mic
      if (originalMicMutedRef.current) {
        const micPubs = Array.from(lp.audioTrackPublications.values()).filter(
          (p) => p.source === Track.Source.Microphone,
        );
        for (const pub of micPubs) {
          if (pub.isMuted) {
            await pub.unmute();
          }
        }
        originalMicMutedRef.current = false;
      }
    } catch {
      // Best-effort cleanup
    }

    setState("off");
    setError(null);
  }, [room]);

  // Activate / deactivate based on enabled + flag
  useEffect(() => {
    if (shouldBeActive) {
      activate();
    } else {
      deactivate();
    }
    return () => {
      // Cleanup on unmount
      deactivate();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldBeActive]);

  return {
    /** Current state of the mixed-publish pipeline */
    state,
    /** Error message if activation failed */
    error,
    /** Whether the platform flag allows this feature */
    flagEnabled,
  } as const;
}
