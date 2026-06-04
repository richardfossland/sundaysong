/**
 * Balanced set composer (recommendation use case E — "build me a whole
 * service, not just find a song").
 *
 * The other recommenders answer narrow questions: `rankPicks` finds the songs
 * most *relevant* to a theme; `applyKeyFlow` smooths a key change after one
 * song; `applyArc` re-orders a fixed set by energy. A worship leader's actual
 * ask is bigger and joint: "give me an ordered set of N songs for this theme
 * that builds along a rising arc, keys flow cleanly, the tempo never lurches,
 * and it isn't all in minor". Those goals trade off against each other — the
 * most on-theme song might be in a clashing key, the perfect-key song might
 * break the arc — so you cannot satisfy them by running each ranker in turn.
 *
 * This module treats it as the constraint-satisfaction problem it is. It scores
 * every candidate's *relevance* once (reusing the `scoreCandidate` heuristic),
 * estimates each one's *energy* (reusing `estimateEnergy`), then SEQUENCES a set
 * with a deterministic beam search that maximises a single explainable
 * objective:
 *
 *     slot relevance                  (reuse recommend.ts scoreCandidate)
 *   + arc fit          (1 − |realised energy − target arc energy|)   [arc.ts]
 *   + key-flow continuity   (keyCompatibilityScore vs the previous song) [music]
 *   + tempo smoothness      (1 − BPM jump / cap, vs the previous song)
 *   − mode-balance penalty  (drift from the requested major/minor ratio)
 *   − hard-constraint penalty (BPM jump over the cap)
 *
 * Each weight is exposed and every term is recorded per slot, so the leader can
 * see *why* each song sits where it does and what the set's energy / key / tempo
 * trajectory looks like.
 *
 * Pure, offline, deterministic. No DB, no embedder, no LLM. The API hands it a
 * candidate pool (catalog songs + their semantic score + key/BPM from a
 * variant) exactly the way `recommend.ts` is fed; everything here is unit
 * testable against an in-memory pool.
 */

import { estimateEnergy } from "@sundaysong/music";
import { keyCompatibilityScore, parseKey, type Key } from "@sundaysong/music";

import { scoreCandidate, type Candidate, type RecommendRequest } from "./recommend";
import { arcCurve, type ArcShape } from "./arc";

// ── Request / candidate / result shapes ──────────────────────────────────────

/** A candidate enriched with the objective musical signals the composer needs. */
export interface SetCandidate extends Candidate {
  /** Key string from a variant, e.g. "G", "Am", "Bb". Null when unknown. */
  key?: string | null;
  /** Beats per minute from a variant. Null when unknown. */
  bpm?: number | null;
  /** Known song length in seconds, when the catalog has it (for duration packing). */
  duration_sec?: number | null;
}

export interface ComposeRequest {
  /** Theme seed — reuses the relevance heuristic from recommend.ts. */
  theme?: string;
  /** Scripture seed. */
  scripture?: string;
  /** Free-text description (folded into relevance the same way). */
  description?: string;
  /** Restrict the pool to one language before composing. */
  language?: string;

  /** Energy shape the set should trace. Omitted → no arc term (flat objective). */
  arc?: ArcShape;

  /**
   * Target number of songs. Takes precedence over `target_duration_min`. When
   * neither is given the composer defaults to {@link DEFAULT_SIZE}.
   */
  target_size?: number;
  /**
   * Target total duration in minutes. The composer grows the set until the
   * estimated running time reaches this (using each song's known length, or
   * {@link DEFAULT_SONG_MIN} when unknown), capped at the pool size.
   */
  target_duration_min?: number;

  /** Constraints — see {@link DEFAULT_CONSTRAINTS} for the defaults. */
  constraints?: ComposeConstraints;
  /** Objective weights — see {@link DEFAULT_WEIGHTS}. */
  weights?: Partial<ComposeWeights>;
  /** Beam width for the search. Larger = closer to optimal, slower. Default 5. */
  beam_width?: number;
}

export interface ComposeConstraints {
  /**
   * Maximum allowed BPM jump between consecutive songs. A jump over this is a
   * *hard* violation and is penalised heavily (the smoothness term plus a
   * large fixed penalty), so the search avoids it whenever a feasible
   * alternative exists. Unknown BPMs are exempt (no jump can be computed).
   */
  max_bpm_jump?: number;
  /**
   * Target fraction of the set that should be in a MAJOR key, 0..1. The
   * composer penalises drift from this ratio so a "celebration" set isn't all
   * minor and a "lament" set isn't all major. Omitted → no mode balancing.
   */
  major_ratio?: number;
}

export interface ComposeWeights {
  relevance: number;
  arc: number;
  keyFlow: number;
  tempo: number;
  modeBalance: number;
}

/** One song placed in the composed set, with the full reasoning behind it. */
export interface ComposedSlot {
  position: number;
  song_id: string;
  title: string;
  /** Combined objective contribution of placing this song here, 0..1-ish. */
  score: number;
  /** Human, multi-part explanation of why this song sits in this slot. */
  reason: string;
  suggested_key: string | null;
  bpm: number | null;
  /** Estimated 0..1 energy of this song (drives the arc fit). */
  energy: number;
  /** Target arc energy for this position (for the trajectory display). */
  target_energy: number;
  /** Whether this slot breaks the BPM-jump cap (informational). */
  tempo_violation: boolean;
}

export interface ComposeTrajectory {
  /** Realised energy at each position, in running order. */
  energy: number[];
  /** Target arc energy at each position (empty when no arc requested). */
  target_energy: number[];
  /** Suggested key at each position (null where unknown). */
  keys: (string | null)[];
  /** BPM at each position (null where unknown). */
  bpm: (number | null)[];
}

export interface ComposeResult {
  slots: ComposedSlot[];
  /** Estimated total running time in minutes. */
  total_minutes_estimate: number;
  /** Fraction of the placed set in a major key (null when no keys are known). */
  major_ratio: number | null;
  /** The energy / key / tempo path through the set. */
  trajectory: ComposeTrajectory;
  /** Number of consecutive pairs that exceed the BPM cap (0 when fully smooth). */
  tempo_violations: number;
  /** Human-readable overview of the composed service. */
  summary: string;
}

// ── Defaults ──────────────────────────────────────────────────────────────────

const DEFAULT_SIZE = 4;
const DEFAULT_SONG_MIN = 4; // matches recommend.ts MIN_PER_SONG
const SEC_PER_MIN = 60;

export const DEFAULT_CONSTRAINTS: Required<ComposeConstraints> = {
  max_bpm_jump: 24,
  major_ratio: 0.5,
};

export const DEFAULT_WEIGHTS: ComposeWeights = {
  relevance: 1.0,
  arc: 0.8,
  keyFlow: 0.6,
  tempo: 0.4,
  modeBalance: 0.5,
};

const DEFAULT_BEAM_WIDTH = 5;

/** Fixed penalty added when a placement breaks the hard BPM-jump cap. */
const HARD_TEMPO_PENALTY = 1.0;

// ── Internal candidate model ───────────────────────────────────────────────────

interface PoolEntry {
  candidate: SetCandidate;
  /** Stable index in the (sorted) pool — the deterministic tie-breaker. */
  order: number;
  relevance: number;
  relevanceReason: string;
  energy: number;
  energyReason: string;
  key: Key | null;
  keyStr: string | null;
  bpm: number | null;
  durationSec: number | null;
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

/** Per-song minutes, from a known length or the rough average. */
function songMinutes(durationSec: number | null): number {
  if (durationSec && durationSec > 0) return durationSec / SEC_PER_MIN;
  return DEFAULT_SONG_MIN;
}

/**
 * Build the scored, deterministic candidate pool. Each entry carries its
 * relevance (reused from `scoreCandidate`), its energy (reused from
 * `estimateEnergy`), and parsed key/BPM. Sorted by relevance descending with a
 * stable tie-break on the candidate id, so the whole composition is
 * reproducible for a fixed input.
 */
function buildPool(req: ComposeRequest, candidates: SetCandidate[]): PoolEntry[] {
  const recReq: RecommendRequest = {
    theme: req.theme,
    scripture: req.scripture,
    description: req.description,
    language: req.language,
  };

  const filtered = candidates.filter((c) => !req.language || c.language === req.language);

  const entries = filtered.map((c) => {
    const { score, reason } = scoreCandidate(recReq, c);
    const key = c.key ? parseKey(c.key) : null;
    const est = estimateEnergy({
      bpm: c.bpm,
      key,
      themes: c.themes,
      title: c.canonical_title,
    });
    return {
      candidate: c,
      order: 0, // assigned after the sort
      relevance: score,
      relevanceReason: reason,
      energy: est.value,
      energyReason: est.reasons[0] ?? "neutral energy",
      key,
      keyStr: c.key ?? null,
      bpm: typeof c.bpm === "number" && Number.isFinite(c.bpm) && c.bpm > 0 ? c.bpm : null,
      durationSec: typeof c.duration_sec === "number" && c.duration_sec > 0 ? c.duration_sec : null,
    } satisfies Omit<PoolEntry, "order"> & { order: number };
  });

  // Deterministic order: relevance desc, then candidate id asc as a stable tie-break.
  entries.sort((a, b) => b.relevance - a.relevance || (a.candidate.id < b.candidate.id ? -1 : a.candidate.id > b.candidate.id ? 1 : 0));
  entries.forEach((e, i) => (e.order = i));
  return entries;
}

/**
 * Resolve how many songs the set should contain.
 *  - explicit `target_size` wins;
 *  - else grow toward `target_duration_min` using per-song lengths;
 *  - else the default size.
 * Always clamped to the pool size.
 */
function resolveTargetSize(req: ComposeRequest, pool: PoolEntry[]): number {
  if (pool.length === 0) return 0;
  if (req.target_size && req.target_size > 0) return Math.min(req.target_size, pool.length);

  if (req.target_duration_min && req.target_duration_min > 0) {
    // Walk the most-relevant songs accumulating minutes until we reach target.
    let minutes = 0;
    let n = 0;
    for (const e of pool) {
      if (minutes >= req.target_duration_min) break;
      minutes += songMinutes(e.durationSec);
      n++;
    }
    return Math.max(1, Math.min(n, pool.length));
  }

  return Math.min(DEFAULT_SIZE, pool.length);
}

// ── Per-edge scoring (the objective's local terms) ─────────────────────────────

/** Key-flow continuity 0..1 vs the previous slot (1 for the opener). */
function keyFlowTerm(prev: PoolEntry | null, cur: PoolEntry): { score: number; reason: string | null } {
  if (!prev) return { score: 1, reason: null }; // opener has nothing to flow from
  if (!prev.key || !cur.key) return { score: 0.5, reason: "key unknown" }; // neutral, no boost/penalty
  const compat = keyCompatibilityScore(prev.key, cur.key);
  return { score: compat.score, reason: compat.reason };
}

/**
 * Tempo smoothness 0..1 vs the previous slot (1 for the opener or unknown BPM).
 * Also reports whether the cap was broken so a hard penalty can be applied.
 */
function tempoTerm(
  prev: PoolEntry | null,
  cur: PoolEntry,
  cap: number,
): { score: number; reason: string | null; violation: boolean } {
  if (!prev || prev.bpm === null || cur.bpm === null) {
    return { score: 1, reason: null, violation: false };
  }
  const jump = Math.abs(prev.bpm - cur.bpm);
  const score = clamp01(1 - jump / Math.max(1, cap));
  const violation = jump > cap;
  const reason =
    jump === 0
      ? `same tempo (${cur.bpm} BPM)`
      : violation
        ? `tempo jump of ${jump} BPM exceeds the ${cap} cap`
        : `smooth tempo (${jump} BPM step)`;
  return { score, reason, violation };
}

/** Arc-fit 0..1: how close this song's energy is to the slot's target energy. */
function arcTerm(cur: PoolEntry, targetEnergy: number | null): { score: number; reason: string | null } {
  if (targetEnergy === null) return { score: 1, reason: null };
  const score = clamp01(1 - Math.abs(cur.energy - targetEnergy));
  return { score, reason: `${energyWord(cur.energy)} fits the arc here` };
}

function energyWord(v: number): string {
  return v >= 0.66 ? "high-energy" : v >= 0.4 ? "mid-energy" : "low-energy";
}

// ── Beam-search state ──────────────────────────────────────────────────────────

interface BeamState {
  /** Pool indices chosen so far, in running order. */
  chosen: number[];
  /** Set of chosen pool indices for O(1) membership. */
  used: Set<number>;
  /** Count of major-key songs chosen so far (for the running mode balance). */
  majorCount: number;
  /** Count of songs with a known key chosen so far. */
  keyedCount: number;
  /** Accumulated objective score. */
  score: number;
}

/**
 * The mode-balance penalty for the running set after placing `cur`. Compares
 * the realised major fraction (over keyed songs) to the requested `major_ratio`
 * and returns the absolute drift 0..1. Only meaningful once keys are known; a
 * set with no keyed songs incurs no penalty.
 */
function modeBalancePenalty(majorCount: number, keyedCount: number, targetMajorRatio: number | null): number {
  if (targetMajorRatio === null || keyedCount === 0) return 0;
  const realised = majorCount / keyedCount;
  return Math.abs(realised - targetMajorRatio);
}

/**
 * Incremental objective contribution of appending `cand` to `state`, given the
 * full target arc, the constraints and the weights. Returns the delta score and
 * the local term values (for the rationale). Deterministic.
 */
function stepScore(
  state: BeamState,
  cand: PoolEntry,
  prev: PoolEntry | null,
  targetEnergy: number | null,
  constraints: Required<ComposeConstraints>,
  hasMajorRatio: boolean,
  weights: ComposeWeights,
): {
  delta: number;
  arc: ReturnType<typeof arcTerm>;
  key: ReturnType<typeof keyFlowTerm>;
  tempo: ReturnType<typeof tempoTerm>;
} {
  const arc = arcTerm(cand, targetEnergy);
  const key = keyFlowTerm(prev, cand);
  const tempo = tempoTerm(prev, cand, constraints.max_bpm_jump);

  // Running mode balance after this placement.
  const nextMajor = state.majorCount + (cand.key && !cand.key.minor ? 1 : 0);
  const nextKeyed = state.keyedCount + (cand.key ? 1 : 0);
  const modeBefore = modeBalancePenalty(state.majorCount, state.keyedCount, hasMajorRatio ? constraints.major_ratio : null);
  const modeAfter = modeBalancePenalty(nextMajor, nextKeyed, hasMajorRatio ? constraints.major_ratio : null);
  // Penalise the *increase* in drift this placement causes (so the search is
  // additive across slots and the opener isn't unfairly charged).
  const modeDelta = Math.max(0, modeAfter - modeBefore);

  let delta =
    weights.relevance * cand.relevance +
    weights.arc * arc.score +
    weights.keyFlow * key.score +
    weights.tempo * tempo.score -
    weights.modeBalance * modeDelta;

  if (tempo.violation) delta -= HARD_TEMPO_PENALTY;

  return { delta, arc, key, tempo };
}

// ── Public entry point ─────────────────────────────────────────────────────────

/**
 * Compose an ordered, balanced worship set from a candidate pool.
 *
 * Algorithm (deterministic beam search):
 *  1. Score + estimate-energy every candidate once; sort into a stable pool.
 *  2. Resolve the target size (explicit, or grown to a duration, or default).
 *  3. Compute the target energy curve for the requested arc at that size.
 *  4. Beam-search the sequence: at each slot, extend every beam by every unused
 *     candidate, score the extension with {@link stepScore}, and keep the top
 *     `beam_width` partial sets (ties broken by the candidates' pool order, so
 *     the result is fully reproducible).
 *  5. Re-derive the per-slot rationale + trajectory for the winning sequence.
 *
 * Pure and offline. With an empty pool it returns an empty result; with one
 * candidate it returns a single-slot set.
 */
export function composeSet(req: ComposeRequest, candidates: SetCandidate[]): ComposeResult {
  const constraints = { ...DEFAULT_CONSTRAINTS, ...req.constraints };
  const weights = { ...DEFAULT_WEIGHTS, ...req.weights };
  const hasMajorRatio = req.constraints?.major_ratio !== undefined;
  const beamWidth = Math.max(1, req.beam_width ?? DEFAULT_BEAM_WIDTH);

  const pool = buildPool(req, candidates);
  const size = resolveTargetSize(req, pool);

  if (size === 0) {
    return {
      slots: [],
      total_minutes_estimate: 0,
      major_ratio: null,
      trajectory: { energy: [], target_energy: [], keys: [], bpm: [] },
      tempo_violations: 0,
      summary:
        "No catalog songs matched closely enough to compose a set — try a broader theme or drop the language filter.",
    };
  }

  const target = req.arc ? arcCurve(req.arc, size) : null;

  // Beam search over running orders.
  let beams: BeamState[] = [{ chosen: [], used: new Set(), majorCount: 0, keyedCount: 0, score: 0 }];

  for (let slot = 0; slot < size; slot++) {
    const targetEnergy = target ? (target[slot] ?? null) : null;
    const expansions: BeamState[] = [];

    for (const beam of beams) {
      const prevIdx = beam.chosen.length > 0 ? beam.chosen[beam.chosen.length - 1]! : -1;
      const prev = prevIdx >= 0 ? pool[prevIdx]! : null;

      for (let ci = 0; ci < pool.length; ci++) {
        if (beam.used.has(ci)) continue;
        const cand = pool[ci]!;
        const { delta } = stepScore(beam, cand, prev, targetEnergy, constraints, hasMajorRatio, weights);
        const used = new Set(beam.used);
        used.add(ci);
        expansions.push({
          chosen: [...beam.chosen, ci],
          used,
          majorCount: beam.majorCount + (cand.key && !cand.key.minor ? 1 : 0),
          keyedCount: beam.keyedCount + (cand.key ? 1 : 0),
          score: beam.score + delta,
        });
      }
    }

    if (expansions.length === 0) break;

    // Keep the best `beamWidth`. Tie-break deterministically on the chosen
    // sequence (lexicographic by pool order) so the search is reproducible.
    expansions.sort((a, b) => b.score - a.score || compareSeq(a.chosen, b.chosen));
    beams = expansions.slice(0, beamWidth);
  }

  // The winning sequence is the highest-scoring full beam (deterministic tie-break).
  beams.sort((a, b) => b.score - a.score || compareSeq(a.chosen, b.chosen));
  const winner = beams[0]!;

  return materialise(req, pool, winner.chosen, target, constraints, weights, hasMajorRatio, size);
}

/** Lexicographic compare of two pool-index sequences (the deterministic tie-break). */
function compareSeq(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] !== b[i]) return a[i]! - b[i]!;
  }
  return a.length - b.length;
}

/** Re-derive the per-slot rationale + trajectory + summary for a chosen sequence. */
function materialise(
  req: ComposeRequest,
  pool: PoolEntry[],
  chosen: number[],
  target: number[] | null,
  constraints: Required<ComposeConstraints>,
  weights: ComposeWeights,
  hasMajorRatio: boolean,
  size: number,
): ComposeResult {
  const slots: ComposedSlot[] = [];
  const energy: number[] = [];
  const targetEnergyArr: number[] = [];
  const keys: (string | null)[] = [];
  const bpm: (number | null)[] = [];
  let majorCount = 0;
  let keyedCount = 0;
  let tempoViolations = 0;
  let totalMinutes = 0;

  // Re-run the step scorer along the final sequence to recover term values.
  const runState: BeamState = { chosen: [], used: new Set(), majorCount: 0, keyedCount: 0, score: 0 };

  chosen.forEach((ci, slot) => {
    const cand = pool[ci]!;
    const prev = slot > 0 ? pool[chosen[slot - 1]!]! : null;
    const targetEnergy = target ? (target[slot] ?? null) : null;
    const { delta, arc, key, tempo } = stepScore(runState, cand, prev, targetEnergy, constraints, hasMajorRatio, weights);

    // Advance the running state so the mode-balance term is correct slot-to-slot.
    runState.chosen.push(ci);
    runState.used.add(ci);
    if (cand.key) {
      keyedCount++;
      runState.keyedCount++;
      if (!cand.key.minor) {
        majorCount++;
        runState.majorCount++;
      }
    }
    runState.score += delta;

    if (tempo.violation) tempoViolations++;
    totalMinutes += songMinutes(cand.durationSec);

    energy.push(round2(cand.energy));
    targetEnergyArr.push(targetEnergy === null ? -1 : round2(targetEnergy));
    keys.push(cand.keyStr);
    bpm.push(cand.bpm);

    // Compose the per-slot reason from the active terms.
    const parts: string[] = [cand.relevanceReason];
    if (req.arc && arc.reason) parts.push(arc.reason);
    if (key.reason) parts.push(`flows: ${key.reason}`);
    if (tempo.reason) parts.push(tempo.reason);
    const reason = parts.join(" · ");

    slots.push({
      position: slot,
      song_id: cand.candidate.id,
      title: cand.candidate.canonical_title,
      score: round3(delta),
      reason,
      suggested_key: cand.keyStr,
      bpm: cand.bpm,
      energy: round2(cand.energy),
      target_energy: targetEnergy === null ? -1 : round2(targetEnergy),
      tempo_violation: tempo.violation,
    });
  });

  const majorRatio = keyedCount > 0 ? round2(majorCount / keyedCount) : null;

  const focus = req.theme ?? req.scripture ?? req.description ?? "your service";
  const arcBit = req.arc ? `, sequenced along a ${req.arc} arc` : "";
  const balanceBit =
    hasMajorRatio && majorRatio !== null
      ? ` Mode balance: ${Math.round(majorRatio * 100)}% major (target ${Math.round(constraints.major_ratio * 100)}%).`
      : "";
  const tempoBit =
    tempoViolations === 0
      ? " Tempo flows within the cap throughout."
      : ` ${tempoViolations} tempo step${tempoViolations === 1 ? "" : "s"} exceed the cap (no smoother option in the pool).`;

  const summary =
    `${size} song${size === 1 ? "" : "s"} for ${focus}${arcBit}, ~${Math.round(totalMinutes)} min.` +
    balanceBit +
    tempoBit +
    " All are real catalog entries you can license and use.";

  return {
    slots,
    total_minutes_estimate: Math.round(totalMinutes),
    major_ratio: majorRatio,
    trajectory: {
      energy,
      target_energy: target ? targetEnergyArr : [],
      keys,
      bpm,
    },
    tempo_violations: tempoViolations,
    summary,
  };
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}
function round3(x: number): number {
  return Math.round(x * 1000) / 1000;
}
