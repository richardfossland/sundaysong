/**
 * Key parsing and spelling preference.
 *
 * A key tells us how to spell accidentals after transposition. Flat keys
 * (F, Bb, Eb, ...) want flats; sharp keys (G, D, A, ...) want sharps. We map a
 * parsed key to that preference so transposed output reads the way a musician
 * expects rather than always defaulting to sharps.
 */

import { noteToPc, pcToNote, type Dialect } from "./notes";

export interface Key {
  /** Tonic pitch class 0..11. */
  pc: number;
  minor: boolean;
}

/** Parse a key like "F#m", "Bb", "Am", "H" (german). Returns null if invalid. */
export function parseKey(input: string, dialect: Dialect = "international"): Key | null {
  const raw = input.trim();
  if (raw.length === 0) return null;
  const minor = /m(in)?$/i.test(raw) && !/maj/i.test(raw);
  const notePart = minor ? raw.replace(/m(in)?$/i, "") : raw;
  const pc = noteToPc(notePart, dialect);
  if (pc === null) return null;
  return { pc, minor };
}

/**
 * The set of tonic pitch classes (by their conventional spelling) that take
 * flats. Built from the circle of fifths: F, Bb, Eb, Ab, Db, Gb on the major
 * side; their relative minors on the minor side.
 */
const FLAT_MAJOR_PCS = new Set([5, 10, 3, 8, 1, 6]); // F, Bb, Eb, Ab, Db, Gb
const FLAT_MINOR_PCS = new Set([2, 7, 0, 5, 10, 3]); // Dm, Gm, Cm, Fm, Bbm, Ebm

/** Does this key conventionally use flats for its accidentals? */
export function keyPrefersFlats(key: Key): boolean {
  return key.minor ? FLAT_MINOR_PCS.has(key.pc) : FLAT_MAJOR_PCS.has(key.pc);
}

/** Render a key back to a display string in the requested dialect. */
export function keyToString(key: Key, dialect: Dialect = "international"): string {
  const note = pcToNote(key.pc, { preferFlats: keyPrefersFlats(key), dialect });
  return key.minor ? `${note}m` : note;
}

/** Smallest non-negative semitone distance to add to get from `from` to `to`. */
export function semitonesBetween(from: Key, to: Key): number {
  return ((to.pc - from.pc) % 12 + 12) % 12;
}
