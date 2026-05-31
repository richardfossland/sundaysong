/**
 * `@sundaysong/music` — pure music-theory engine.
 *
 * Transposition, Nashville numbers, capo suggestions, ChordPro handling, and
 * key detection. Zero runtime dependencies; safe to run on the edge, in a
 * worker, or in the browser. Powers the "instant transposition" feature and
 * is consumed by SundayStage and SundayPlan via the public API.
 */

export { type Dialect, SHARP_NAMES, FLAT_NAMES, noteToPc, pcToNote } from "./notes";
export { type Key, parseKey, keyPrefersFlats, keyToString, semitonesBetween } from "./keys";
export {
  type KeyCompatibility,
  circleOfFifthsDistance,
  relativePc,
  keyCompatibilityScore,
} from "./keyFlow";
export {
  type EnergySignals,
  type EnergyEstimate,
  bpmEnergy,
  estimateEnergy,
} from "./energy";
export { type Chord, parseChord, chordToString, transposeChord, transposeChordSymbol } from "./chord";
export {
  type TransposeToKeyResult,
  shortestSemitones,
  transposeKeyName,
  transposeChordsToKey,
  transposeChordsBySemitones,
} from "./transpose";
export { toNashville, fromNashville } from "./nashville";
export { type CapoSuggestion, suggestCapo } from "./capo";
export {
  transposeChordProBySemitones,
  transposeChordProToKey,
  extractChords,
  normalizeKey,
} from "./chordpro";
export { type DetectedKey, detectKey } from "./detectKey";
