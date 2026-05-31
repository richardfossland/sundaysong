/**
 * Per-song *energy* estimation for set building (recommendation use case D —
 * "build a set with a rising / reflective / celebratory / lament arc").
 *
 * A worship set has a shape: it might build from a quiet call-to-worship up to
 * a celebratory peak, or wind down into reflection before communion. To
 * sequence songs into that shape we need a single 0..1 "energy" number per
 * song — high = loud, fast, celebratory; low = slow, intimate, reflective.
 *
 * This is a pure, zero-dependency estimator over the objective musical signals
 * we actually have in the catalog (BPM, key mode, meter) plus the controlled
 * theme vocabulary and the title. It is deliberately conservative: with no
 * signal it returns a neutral 0.5 so the set builder can fall back to its other
 * dimensions. The arc *sequencing* itself lives in `@sundaysong/ai` arc.ts;
 * this module only answers "how intense is this one song?".
 *
 * The numbers are heuristic by design — there is no ground-truth "energy"
 * column — but they are deterministic and explainable, which is what the
 * recommender needs to justify a running order to a worship leader.
 */

import type { Key } from "./keys";

/** Objective signals we read off a song/variant to estimate its energy. */
export interface EnergySignals {
  /** Beats per minute, when known. */
  bpm?: number | null;
  /** Parsed key, when known — minor keys read as lower energy. */
  key?: Key | null;
  /** Controlled theme vocabulary tags (lower-cased internally). */
  themes?: readonly string[];
  /** Canonical title — keyword fallback when nothing else is known. */
  title?: string | null;
}

export interface EnergyEstimate {
  /** 0..1, higher = louder / faster / more celebratory. */
  value: number;
  /** Short, human reasons that drove the estimate (for explanations). */
  reasons: string[];
  /** True when no usable signal was found and `value` is the neutral default. */
  unknown: boolean;
}

const NEUTRAL = 0.5;

/**
 * Map a BPM to an energy contribution 0..1. Worship tempos run roughly 60–140;
 * we anchor 60 BPM (slow ballad) near 0 and 140 BPM (driving anthem) near 1,
 * clamped, with a gentle linear ramp between. Outside that range saturates.
 */
export function bpmEnergy(bpm: number): number {
  const lo = 60;
  const hi = 140;
  const t = (bpm - lo) / (hi - lo);
  return Math.max(0, Math.min(1, t));
}

// Theme keywords that pull energy UP (celebration / movement) or DOWN
// (intimacy / reflection). Matched as substrings so "celebration" hits
// "celebratory" etc.; kept small and worship-specific on purpose.
const HIGH_THEMES = [
  "celebration",
  "praise",
  "joy",
  "victory",
  "freedom",
  "resurrection",
  "dance",
  "shout",
  "energy",
] as const;
const LOW_THEMES = [
  "lament",
  "reflection",
  "communion",
  "surrender",
  "prayer",
  "grief",
  "rest",
  "stillness",
  "confession",
  "intimacy",
] as const;

// Title keywords are a last-resort signal (e.g. PD hymns with no BPM/themes).
const HIGH_TITLE = ["shout", "rejoice", "celebrate", "victory", "alleluia", "hallelujah", "joy"] as const;
const LOW_TITLE = ["still", "quiet", "rest", "abide", "kneel", "humble", "softly"] as const;

const norm = (s: string) => s.toLowerCase();

function anyHit(haystack: string, needles: readonly string[]): string | null {
  const h = norm(haystack);
  return needles.find((n) => h.includes(n)) ?? null;
}

function themeHit(themes: readonly string[], needles: readonly string[]): string | null {
  for (const t of themes) {
    const hit = anyHit(t, needles);
    if (hit) return t;
  }
  return null;
}

/**
 * Estimate a song's energy 0..1 from whatever signals are present.
 *
 * Precedence, strongest first:
 *  1. BPM — the most objective signal; if present it anchors the estimate and
 *     mode/theme keywords only nudge it ±0.1.
 *  2. With no BPM, blend the available softer signals (key mode, themes, title)
 *     around the neutral midpoint.
 *  3. With nothing usable, return the neutral 0.5 flagged `unknown`.
 *
 * Pure and deterministic. Every applied signal is recorded in `reasons`.
 */
export function estimateEnergy(signals: EnergySignals): EnergyEstimate {
  const reasons: string[] = [];
  const themes = (signals.themes ?? []).map(norm);

  const highTheme = themeHit(themes, HIGH_THEMES);
  const lowTheme = themeHit(themes, LOW_THEMES);
  const minor = signals.key?.minor === true;

  if (typeof signals.bpm === "number" && Number.isFinite(signals.bpm) && signals.bpm > 0) {
    let value = bpmEnergy(signals.bpm);
    reasons.push(`${signals.bpm} BPM`);
    // Mode + theme are gentle nudges once BPM has anchored the estimate.
    if (minor) {
      value -= 0.05;
      reasons.push("minor key (more reflective)");
    }
    if (highTheme) {
      value += 0.05;
      reasons.push(`uplifting theme (${highTheme})`);
    }
    if (lowTheme) {
      value -= 0.05;
      reasons.push(`reflective theme (${lowTheme})`);
    }
    return { value: clamp01(value), reasons, unknown: false };
  }

  // No BPM: build around the neutral midpoint from softer signals.
  let value = NEUTRAL;
  let any = false;

  if (highTheme) {
    value += 0.2;
    any = true;
    reasons.push(`uplifting theme (${highTheme})`);
  }
  if (lowTheme) {
    value -= 0.2;
    any = true;
    reasons.push(`reflective theme (${lowTheme})`);
  }
  if (signals.key) {
    value += minor ? -0.1 : 0.05;
    any = true;
    reasons.push(minor ? "minor key (more reflective)" : "major key");
  }

  // Title keywords only matter when we had no theme/key signal at all.
  if (!any && signals.title) {
    if (anyHit(signals.title, HIGH_TITLE)) {
      value += 0.2;
      any = true;
      reasons.push("celebratory title");
    } else if (anyHit(signals.title, LOW_TITLE)) {
      value -= 0.2;
      any = true;
      reasons.push("reflective title");
    }
  }

  if (!any) {
    return { value: NEUTRAL, reasons: ["no tempo/theme signal — neutral energy"], unknown: true };
  }
  return { value: clamp01(value), reasons, unknown: false };
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, Math.round(x * 100) / 100));
}
