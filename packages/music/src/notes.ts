/**
 * Pitch-class model + note spelling.
 *
 * A pitch class is 0..11 (C=0). We deliberately work in pitch classes for
 * transposition and only re-spell to letters at the edges, where the target
 * key (or an explicit preference) decides sharps vs flats.
 *
 * Dialect matters in the Nordic market: in German/Scandinavian notation
 * `H` is B-natural (pc 11) and a bare `B` is B-flat (pc 10). International
 * notation has no `H`, and `B` is B-natural. This is the single most common
 * way a chord chart gets mis-transposed, so it is first-class here.
 */

export type Dialect = "international" | "german";

export const SHARP_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;
export const FLAT_NAMES = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"] as const;

/** Pitch class of the natural letters (international: A..G). */
const LETTER_PC: Record<string, number> = {
  C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11,
};

/**
 * Parse a note name (the root portion of a chord, no quality suffix) to a
 * pitch class. Accepts ASCII accidentals `#`/`b`, the unicode `♯`/`♭`, and the
 * German verbose `is`/`es` suffixes. Returns `null` if it isn't a note.
 *
 * In the `german` dialect, `H` => 11 and a bare `B` => 10.
 */
export function noteToPc(input: string, dialect: Dialect = "international"): number | null {
  const raw = input.trim();
  if (raw.length === 0) return null;

  const letter = raw[0]!.toUpperCase();
  let rest = raw.slice(1);

  let pc: number;
  if (letter === "H") {
    if (dialect !== "german") return null; // H is only a note in German notation
    pc = 11;
  } else if (letter === "B" && dialect === "german") {
    pc = 10; // German B = B-flat. Accidentals still apply on top (rare but legal).
  } else if (letter in LETTER_PC) {
    pc = LETTER_PC[letter]!;
  } else {
    return null;
  }

  // Accidentals: a single ASCII/unicode accidental, or one German is/es group.
  // We accept at most one accidental on a root — double accidentals never
  // appear in real worship chord charts and allowing them invites ambiguity
  // with quality suffixes like "b5".
  if (rest.startsWith("#") || rest.startsWith("♯")) {
    pc += 1;
    rest = rest.slice(1);
  } else if (rest.startsWith("b") || rest.startsWith("♭")) {
    pc -= 1;
    rest = rest.slice(1);
  } else if (/^is/i.test(rest)) {
    pc += 1;
    rest = rest.slice(2);
  } else if (/^es/i.test(rest)) {
    pc -= 1;
    rest = rest.slice(2);
  }

  if (rest.length !== 0) return null; // leftover chars => not a bare note
  return ((pc % 12) + 12) % 12;
}

/** Render a pitch class to a letter, choosing sharps or flats. */
export function pcToNote(
  pc: number,
  opts: { preferFlats?: boolean; dialect?: Dialect } = {},
): string {
  const norm = ((pc % 12) + 12) % 12;
  const dialect = opts.dialect ?? "international";

  if (dialect === "german") {
    // German swaps B/H and uses the verbose accidental names so the result is
    // unambiguous: 10 => "B" (=Bb), 11 => "H" (=B-natural).
    if (norm === 11) return "H";
    if (norm === 10) return "B";
    const base = opts.preferFlats ? FLAT_NAMES[norm]! : SHARP_NAMES[norm]!;
    // Re-letter the accidental names the German way (Cis/Des) only when asked
    // is overkill for chord charts; keep ASCII #/b which Nordic charts use too.
    return base;
  }

  return opts.preferFlats ? FLAT_NAMES[norm]! : SHARP_NAMES[norm]!;
}
