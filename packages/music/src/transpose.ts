/**
 * Key-aware transposition — the surface most callers want.
 *
 * Given chords and a source/target key, transpose every chord and spell the
 * results the way the target key wants (flats for flat keys, sharps for sharp
 * keys). Knowing the source key also lets us choose the *shortest* direction
 * so "C -> Bb" goes down two semitones rather than up ten.
 */

import { type Dialect } from "./notes";
import { parseKey, keyPrefersFlats, keyToString, type Key } from "./keys";
import { transposeChordSymbol } from "./chord";

export interface TransposeToKeyResult {
  fromKey: string;
  toKey: string;
  semitones: number;
  chords: string[];
}

/** Signed semitone delta from `from` to `to` in [-6, +6] (shortest path). */
export function shortestSemitones(from: Key, to: Key): number {
  let d = ((to.pc - from.pc) % 12 + 12) % 12;
  if (d > 6) d -= 12;
  return d;
}

/**
 * Transpose a list of chord symbols from one key to another. Spelling follows
 * the target key. Throws on an unparseable key (callers pass real keys).
 */
export function transposeChordsToKey(
  chords: string[],
  fromKey: string,
  toKey: string,
  dialect: Dialect = "international",
): TransposeToKeyResult {
  const from = parseKey(fromKey, dialect);
  const to = parseKey(toKey, dialect);
  if (!from) throw new Error(`invalid source key: ${fromKey}`);
  if (!to) throw new Error(`invalid target key: ${toKey}`);

  const semitones = shortestSemitones(from, to);
  const preferFlats = keyPrefersFlats(to);
  const transposed = chords.map((c) =>
    transposeChordSymbol(c, semitones, { preferFlats, dialect }, dialect),
  );

  return {
    fromKey: keyToString(from, dialect),
    toKey: keyToString(to, dialect),
    semitones,
    chords: transposed,
  };
}

/** The key you land in after shifting `fromKey` by `semitones`, as a string. */
export function transposeKeyName(
  fromKey: string,
  semitones: number,
  dialect: Dialect = "international",
): string {
  const from = parseKey(fromKey, dialect);
  if (!from) throw new Error(`invalid source key: ${fromKey}`);
  const landed: Key = { pc: ((from.pc + semitones) % 12 + 12) % 12, minor: from.minor };
  return keyToString(landed, dialect);
}

/**
 * Transpose by a raw number of semitones, spelling the output for the key you
 * land in (derived from a known source key). Useful for "+1 / -1" buttons.
 */
export function transposeChordsBySemitones(
  chords: string[],
  semitones: number,
  fromKey: string,
  dialect: Dialect = "international",
): TransposeToKeyResult {
  const from = parseKey(fromKey, dialect);
  if (!from) throw new Error(`invalid source key: ${fromKey}`);
  const landed: Key = { pc: ((from.pc + semitones) % 12 + 12) % 12, minor: from.minor };
  const preferFlats = keyPrefersFlats(landed);
  const transposed = chords.map((c) =>
    transposeChordSymbol(c, semitones, { preferFlats, dialect }, dialect),
  );
  return {
    fromKey: keyToString(from, dialect),
    toKey: keyToString(landed, dialect),
    semitones,
    chords: transposed,
  };
}
