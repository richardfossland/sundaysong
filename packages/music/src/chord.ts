/**
 * Chord parsing, transposition, and serialization.
 *
 * We parse a chord into { root, quality, bass }. The quality suffix
 * (`m7`, `maj7`, `sus4`, `m7b5`, `add9`, `dim`, ...) is preserved verbatim and
 * never interpreted — transposition only moves the root and the slash bass.
 * This makes the engine correct for every extension without enumerating them.
 */

import { noteToPc, pcToNote, type Dialect } from "./notes";

export interface Chord {
  /** Root pitch class 0..11. */
  root: number;
  /** Everything after the root, e.g. "m7", "sus4", "maj7#11". Empty = major. */
  quality: string;
  /** Slash-bass pitch class, or null when there is no slash. */
  bass: number | null;
}

const ROOT_RE = /^([A-Ha-h])(##|bb|#|b|♯|♭|is|es)?/;

/**
 * Parse a chord symbol. Returns null when the token clearly isn't a chord
 * (so lyrics passing through ChordPro brackets are left untouched).
 */
export function parseChord(symbol: string, dialect: Dialect = "international"): Chord | null {
  const raw = symbol.trim();
  if (raw.length === 0) return null;

  const slashIdx = raw.indexOf("/");
  const head = slashIdx === -1 ? raw : raw.slice(0, slashIdx);
  const bassPart = slashIdx === -1 ? null : raw.slice(slashIdx + 1);

  const m = ROOT_RE.exec(head);
  if (!m) return null;
  const rootToken = m[0];
  const root = noteToPc(rootToken, dialect);
  if (root === null) return null;

  const quality = head.slice(rootToken.length);

  let bass: number | null = null;
  if (bassPart !== null) {
    bass = noteToPc(bassPart.trim(), dialect);
    if (bass === null) return null; // a slash with a non-note bass isn't a chord
  }

  return { root, quality, bass };
}

/** Serialize a chord back to a string in the given spelling. */
export function chordToString(
  chord: Chord,
  opts: { preferFlats?: boolean; dialect?: Dialect } = {},
): string {
  const root = pcToNote(chord.root, opts);
  const bass = chord.bass === null ? "" : "/" + pcToNote(chord.bass, opts);
  return root + chord.quality + bass;
}

/** Transpose a parsed chord by a number of semitones (may be negative). */
export function transposeChord(chord: Chord, semitones: number): Chord {
  const shift = (pc: number) => ((pc + semitones) % 12 + 12) % 12;
  return {
    root: shift(chord.root),
    quality: chord.quality,
    bass: chord.bass === null ? null : shift(chord.bass),
  };
}

/**
 * Transpose a chord symbol string by semitones. `spelling.preferFlats`
 * controls the output spelling (usually derived from the target key).
 * Non-chord tokens are returned unchanged.
 */
export function transposeChordSymbol(
  symbol: string,
  semitones: number,
  spelling: { preferFlats?: boolean; dialect?: Dialect } = {},
  parseDialect: Dialect = "international",
): string {
  const parsed = parseChord(symbol, parseDialect);
  if (!parsed) return symbol;
  return chordToString(transposeChord(parsed, semitones), spelling);
}
