import { useSyncExternalStore } from "react";
import { VideoDeck, type VideoDeckState } from "../../lib/mediaVideo";
import { videoPersistence } from "../../lib/mediaVideoApi";
import { getMixer } from "../../lib/mixerInstance";

let deck: VideoDeck | null = null;

/** Tab-lifetime stage-video deck, sharing the mixer's AudioContext (like getAudioDeck()). */
export function getVideoDeck(): VideoDeck {
  if (!deck) deck = new VideoDeck(getMixer(), videoPersistence);
  return deck;
}

/** Subscribes a component to the video deck's state. */
export function useVideoDeck(): { deck: VideoDeck; state: VideoDeckState } {
  const d = getVideoDeck();
  const state = useSyncExternalStore(
    (cb) => d.subscribe(cb),
    () => d.getState(),
    () => d.getState(),
  );
  return { deck: d, state };
}
