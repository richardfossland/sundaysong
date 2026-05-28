/**
 * ChordPro transposition.
 *
 * ChordPro inlines chords in square brackets: `[C]Amazing [F]grace`. We
 * transpose only the bracketed tokens and leave lyrics, directives
 * (`{title: ...}`), and comments untouched. A token that doesn't parse as a
 * chord (e.g. `[x2]`, `[N.C.]`) is passed through verbatim.
 */

import { type Dialect } from "./notes";
import { parseKey, keyPrefersFlats, keyToString, type Key } from "./keys";
import { transposeChordSymbol } from "./chord";
import { shortestSemitones } from "./transpose";

const BRACKET_RE = /\[([^\]]*)\]/g;

/** Transpose all bracketed chords in a ChordPro string by semitones. */
export function transposeChordProBySemitones(
  text: string,
  semitones: number,
  spelling: { preferFlats?: boolean; dialect?: Dialect } = {},
  parseDialect: Dialect = "international",
): string {
  return text.replace(BRACKET_RE, (_match, inner: string) => {
    const transposed = transposeChordSymbol(inner, semitones, spelling, parseDialect);
    return `[${transposed}]`;
  });
}

/** Transpose a ChordPro string from one key to another, spelled for the target. */
export function transposeChordProToKey(
  text: string,
  fromKey: string,
  toKey: string,
  dialect: Dialect = "international",
): { text: string; semitones: number } {
  const from = parseKey(fromKey, dialect);
  const to = parseKey(toKey, dialect);
  if (!from) throw new Error(`invalid source key: ${fromKey}`);
  if (!to) throw new Error(`invalid target key: ${toKey}`);
  const semitones = shortestSemitones(from, to);
  const text2 = transposeChordProBySemitones(
    text,
    semitones,
    { preferFlats: keyPrefersFlats(to), dialect },
    dialect,
  );
  return { text: text2, semitones };
}

/** Pull the chord tokens out of a ChordPro string, in order. */
export function extractChords(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(BRACKET_RE)) {
    const inner = m[1]!.trim();
    if (inner.length > 0) out.push(inner);
  }
  return out;
}

/** Convenience: parse + restring a key's display form (used by the API layer). */
export function normalizeKey(key: string, dialect: Dialect = "international"): string | null {
  const k: Key | null = parseKey(key, dialect);
  return k ? keyToString(k, dialect) : null;
}
