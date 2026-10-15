import { AudioMixer } from "./audioMixer";

// Singleton mixer for the lifetime of the tab (shared by the mixer modal,
// MixerBridge, local recording and the audio deck).
let _mixerInstance: AudioMixer | null = null;

export function getMixer(): AudioMixer {
  if (!_mixerInstance) _mixerInstance = new AudioMixer();
  return _mixerInstance;
}
