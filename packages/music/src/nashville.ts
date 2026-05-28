/**
 * Nashville number system <-> chord symbols.
 *
 * Nashville numbers describe a chord by its scale degree in a key, so a chart
 * is key-independent: "1 5 6m 4" is the same shape in every key. We map a
 * chord's root to a degree (1..7) with an accidental prefix for out-of-scale
 * roots (b3, #4), and carry the quality suffix through unchanged.
 */

import { pcToNote, type Dialect } from "./notes";
import { parseChord } from "./chord";
import { parseKey, keyPrefersFlats, type Key } from "./keys";

// Major-scale semitone offsets for degrees 1..7.
const MAJOR_OFFSETS = [0, 2, 4, 5, 7, 9, 11];
// Reverse: offset -> { degree, accidental } using flats for the chromatic notes.
const OFFSET_TO_DEGREE: Record<number, { degree: number; accidental: string }> = {
  0: { degree: 1, accidental: "" },
  1: { degree: 2, accidental: "b" },
  2: { degree: 2, accidental: "" },
  3: { degree: 3, accidental: "b" },
  4: { degree: 3, accidental: "" },
  5: { degree: 4, accidental: "" },
  6: { degree: 5, accidental: "b" },
  7: { degree: 5, accidental: "" },
  8: { degree: 6, accidental: "b" },
  9: { degree: 6, accidental: "" },
  10: { degree: 7, accidental: "b" },
  11: { degree: 7, accidental: "" },
};

/** Convert one chord symbol to its Nashville number within `key`. */
export function toNashville(symbol: string, key: string, dialect: Dialect = "international"): string | null {
  const k = parseKey(key, dialect);
  if (!k) return null;
  const chord = parseChord(symbol, dialect);
  if (!chord) return null;

  const offset = ((chord.root - k.pc) % 12 + 12) % 12;
  const mapped = OFFSET_TO_DEGREE[offset]!;
  const bass = chord.bass === null ? "" : "/" + bassToNashville(chord.bass, k.pc);
  return `${mapped.accidental}${mapped.degree}${chord.quality}${bass}`;
}

function bassToNashville(bassPc: number, tonicPc: number): string {
  const offset = ((bassPc - tonicPc) % 12 + 12) % 12;
  const mapped = OFFSET_TO_DEGREE[offset]!;
  return `${mapped.accidental}${mapped.degree}`;
}

const NASHVILLE_RE = /^([b#♭♯]?)([1-7])(.*)$/;

/** Convert a Nashville token (e.g. "6m", "b7", "4/6") back to a chord in `key`. */
export function fromNashville(token: string, key: string, dialect: Dialect = "international"): string | null {
  const k = parseKey(key, dialect);
  if (!k) return null;

  const slashIdx = token.indexOf("/");
  const head = slashIdx === -1 ? token : token.slice(0, slashIdx);
  const bassPart = slashIdx === -1 ? null : token.slice(slashIdx + 1);

  const root = nashvilleHeadToPc(head, k.pc);
  if (root === null) return null;
  const m = NASHVILLE_RE.exec(head.trim())!;
  const quality = m[3] ?? "";

  // A flat Nashville degree (b3, b7) should spell flat; a sharp one sharp.
  // Diatonic degrees fall back to the key's own preference.
  const rootFlats = spellPreferenceFor(m[1]!, k);
  let out = pcToNote(root, { preferFlats: rootFlats, dialect }) + quality;
  if (bassPart !== null) {
    const bm = NASHVILLE_RE.exec(bassPart.trim());
    const bassPc = nashvilleHeadToPc(bassPart.trim(), k.pc);
    if (bassPc === null || !bm) return null;
    out += "/" + pcToNote(bassPc, { preferFlats: spellPreferenceFor(bm[1]!, k), dialect });
  }
  return out;
}

function spellPreferenceFor(accidental: string, key: Key): boolean {
  if (accidental === "b" || accidental === "♭") return true;
  if (accidental === "#" || accidental === "♯") return false;
  return keyPrefersFlats(key);
}

function nashvilleHeadToPc(head: string, tonicPc: number): number | null {
  const m = NASHVILLE_RE.exec(head.trim());
  if (!m) return null;
  const accidental = m[1]!;
  const degree = Number(m[2]);
  let pc = tonicPc + MAJOR_OFFSETS[degree - 1]!;
  if (accidental === "b" || accidental === "♭") pc -= 1;
  else if (accidental === "#" || accidental === "♯") pc += 1;
  return ((pc % 12) + 12) % 12;
}
