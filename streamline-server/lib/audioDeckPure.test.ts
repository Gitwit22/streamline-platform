import test from "node:test";
import assert from "node:assert/strict";
import { AUDIO_DECK_LIMITS, EMPTY_AUDIO_DECK, normalizeAudioDeck, parseAudioDeckInput } from "./audioDeckPure";

test("parseAudioDeckInput accepts a valid layout and defaults volume/loop", () => {
  const r = parseAudioDeckInput({
    playlist: [{ assetId: "a1", name: " Intro music " }],
    pads: [{ assetId: "a2", name: "Applause", volume: 0.555 }],
  });
  assert.equal(r.ok, true);
  assert.deepEqual(r.value, {
    playlist: [{ assetId: "a1", name: "Intro music", volume: 1 }],
    pads: [{ assetId: "a2", name: "Applause", volume: 0.56 }],
    loopMode: "all",
  });
});

test("parseAudioDeckInput rejects bad items", () => {
  assert.equal(parseAudioDeckInput({ playlist: [{ assetId: "a/b", name: "x" }] }).field, "playlist[0].assetId");
  assert.equal(parseAudioDeckInput({ pads: [{ assetId: "a", name: "" }] }).field, "pads[0].name");
  assert.equal(parseAudioDeckInput({ pads: [{ assetId: "a", name: "x", volume: 2 }] }).field, "pads[0].volume");
  assert.equal(parseAudioDeckInput({ pads: [{ assetId: "a", name: "x", volume: "1" }] }).field, "pads[0].volume");
  assert.equal(parseAudioDeckInput({ loopMode: "shuffle" }).field, "loopMode");
  const many = Array.from({ length: AUDIO_DECK_LIMITS.pads + 1 }, (_, i) => ({ assetId: `p${i}`, name: "x" }));
  assert.equal(parseAudioDeckInput({ pads: many }).field, "pads");
  assert.equal(parseAudioDeckInput(null).ok, false);
});

test("normalizeAudioDeck tolerates missing or broken stored data", () => {
  assert.deepEqual(normalizeAudioDeck(undefined), EMPTY_AUDIO_DECK);
  assert.deepEqual(normalizeAudioDeck({ playlist: "bad" }), EMPTY_AUDIO_DECK);
  assert.equal(normalizeAudioDeck({ loopMode: "one", updatedAt: 5 }).loopMode, "one");
});
