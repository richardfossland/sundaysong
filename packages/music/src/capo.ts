/**
 * Capo suggestions for guitarists.
 *
 * A capo lets a player use easy open-chord shapes while sounding in a hard
 * key. If the song is in Eb, putting a capo on fret 1 and playing D shapes (or
 * fret 3 playing C shapes) sounds in Eb but is far easier. We search capo
 * positions for ones whose "play-as" key is an open-friendly shape.
 */

import { pcToNote, type Dialect } from "./notes";
import { parseKey, keyPrefersFlats, type Key } from "./keys";

// Open-chord-friendly shape tonics (CAGED). Major shapes: C G D A E.
const EASY_MAJOR_PCS = [0, 7, 2, 9, 4]; // C, G, D, A, E
// Open minor shapes: Am, Em, Dm.
const EASY_MINOR_PCS = [9, 4, 2]; // Am, Em, Dm

export interface CapoSuggestion {
  /** Fret the capo goes on (1..11). */
  capo: number;
  /** The key whose shapes you actually finger. */
  playAs: string;
}

/**
 * Suggest capo positions for a target key, best (lowest, easiest) first.
 * Capo 0 is excluded — if the key is already open-friendly the caller can see
 * that from an empty list and just play it open.
 */
export function suggestCapo(targetKey: string, dialect: Dialect = "international"): CapoSuggestion[] {
  const key = parseKey(targetKey, dialect);
  if (!key) return [];

  const easy = key.minor ? EASY_MINOR_PCS : EASY_MAJOR_PCS;
  const suggestions: Array<CapoSuggestion & { rank: number }> = [];

  for (let capo = 1; capo <= 11; capo++) {
    const shapePc = ((key.pc - capo) % 12 + 12) % 12;
    const rank = easy.indexOf(shapePc);
    if (rank === -1) continue;
    const playKey: Key = { pc: shapePc, minor: key.minor };
    const note = pcToNote(shapePc, { preferFlats: keyPrefersFlats(playKey), dialect });
    suggestions.push({ capo, playAs: key.minor ? `${note}m` : note, rank });
  }

  // Prefer low capo positions; break ties by how open-friendly the shape is.
  suggestions.sort((a, b) => a.capo - b.capo || a.rank - b.rank);
  return suggestions.map(({ capo, playAs }) => ({ capo, playAs }));
}
