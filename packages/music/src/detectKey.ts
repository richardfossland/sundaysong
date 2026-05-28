/**
 * Source-key detection from a chord progression.
 *
 * Worship charts often arrive without a key tag. We score all 24 keys (12
 * major + 12 minor) by how well the chords fit, with weight on the tonic
 * appearing first/last and on the dominant being present, then return the best
 * fit with a confidence. This is a heuristic, not theory-complete, but it is
 * reliable on the diatonic progressions worship songs actually use.
 */

import { type Dialect } from "./notes";
import { keyToString, type Key } from "./keys";
import { parseChord } from "./chord";

const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11];
const MINOR_SCALE = [0, 2, 3, 5, 7, 8, 10]; // natural minor

// Expected triad quality at each scale degree.
const MAJOR_QUALITIES = ["", "m", "m", "", "", "m", "dim"];
const MINOR_QUALITIES = ["m", "dim", "", "m", "m", "", ""];

export interface DetectedKey {
  key: string;
  /** 0..1 — share of chords that fit the winning key, blended with cues. */
  confidence: number;
}

function qualityClass(quality: string): "min" | "dim" | "maj" {
  const q = quality.toLowerCase();
  if (q.startsWith("dim") || q.startsWith("°") || q.startsWith("º") || /^m7b5/.test(q)) return "dim";
  // "maj7" is a major chord; a leading "m" (not "maj") means minor.
  if (q.startsWith("m") && !q.startsWith("maj")) return "min";
  return "maj";
}

function expectedClass(label: string): "min" | "dim" | "maj" {
  if (label === "m") return "min";
  if (label === "dim") return "dim";
  return "maj";
}

/** Detect the most likely key. Returns null if no chords parse. */
export function detectKey(chords: string[], dialect: Dialect = "international"): DetectedKey | null {
  const parsed = chords
    .map((c) => parseChord(c, dialect))
    .filter((c): c is NonNullable<typeof c> => c !== null);
  if (parsed.length === 0) return null;

  const firstRoot = parsed[0]!.root;
  const lastRoot = parsed[parsed.length - 1]!.root;

  let best: { key: Key; score: number } | null = null;

  for (let tonic = 0; tonic < 12; tonic++) {
    for (const minor of [false, true]) {
      const scale = minor ? MINOR_SCALE : MAJOR_SCALE;
      const quals = minor ? MINOR_QUALITIES : MAJOR_QUALITIES;
      let score = 0;

      for (const ch of parsed) {
        const offset = ((ch.root - tonic) % 12 + 12) % 12;
        const degree = scale.indexOf(offset);
        if (degree === -1) continue; // out-of-scale chord, no credit
        score += 1;
        if (qualityClass(ch.quality) === expectedClass(quals[degree]!)) score += 0.5;
      }

      // Tonic cues: progressions tend to start and (especially) end on I/i.
      if (firstRoot === tonic) score += 1.5;
      if (lastRoot === tonic) score += 2.5;
      // Dominant present (V) is strong evidence for a key.
      const domPc = (tonic + 7) % 12;
      if (parsed.some((c) => c.root === domPc)) score += 0.5;

      if (!best || score > best.score) best = { key: { pc: tonic, minor }, score };
    }
  }

  if (!best) return null;
  // Confidence: winning score normalized by a generous per-chord ceiling.
  const ceiling = parsed.length * 1.5 + 4.5;
  const confidence = Math.max(0, Math.min(1, best.score / ceiling));
  return { key: keyToString(best.key, dialect), confidence: Number(confidence.toFixed(2)) };
}
