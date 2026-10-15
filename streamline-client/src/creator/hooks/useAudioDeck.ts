import { useSyncExternalStore } from "react";
import { AudioDeck, type DeckState } from "../../lib/audioDeck";
import { deckPersistence } from "../../lib/audioDeckApi";
import { getMixer } from "../../lib/mixerInstance";

let deck: AudioDeck | null = null;

/** Tab-lifetime deck, wired to the shared mixer (same lifetime as getMixer()). */
export function getAudioDeck(): AudioDeck {
  if (!deck) deck = new AudioDeck(getMixer(), deckPersistence);
  return deck;
}

/** Subscribes a component to the deck's state. */
export function useAudioDeck(): { deck: AudioDeck; state: DeckState } {
  const d = getAudioDeck();
  const state = useSyncExternalStore(
    (cb) => d.subscribe(cb),
    () => d.getState(),
    () => d.getState(),
  );
  return { deck: d, state };
}
