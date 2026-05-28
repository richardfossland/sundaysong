/**
 * Mechanism 2 — score whether two songs are translations of each other.
 *
 * Cross-language title text barely overlaps, so we lean on language-agnostic
 * metadata: a shared CCLI/TONO registration is near-proof; shared scripture
 * references and the same composer are strong; themes, publication year, and
 * fuzzy title cognates are weak supporting signals. Output is a confidence and
 * a recommendation (auto-link / propose for review / reject) plus the signals
 * that drove it, so an admin sees *why*.
 */

import type { CandidateScore, MatchSignal, MatchSong, Recommendation } from "./types";

const WEIGHTS = {
  sharedCcli: 0.9,
  sharedTono: 0.9,
  bibleRefs: 0.35,
  themes: 0.25,
  sharedComposer: 0.25,
  yearProximity: 0.05,
  titleTokens: 0.1,
} as const;

const AUTO_LINK_AT = 0.8;
const PROPOSE_AT = 0.45;
const YEAR_WINDOW = 80;

/** Collapse Norwegian variants so nb/nn/no count as one language. */
function normLang(lang: string): string {
  const l = lang.toLowerCase().split("-")[0]!;
  if (l === "nb" || l === "nn") return "no";
  return l;
}

export function scoreTranslationCandidate(a: MatchSong, b: MatchSong): CandidateScore {
  const signals: MatchSignal[] = [];

  // A translation is cross-language by definition.
  if (normLang(a.language) === normLang(b.language)) {
    return {
      a_id: a.id,
      b_id: b.id,
      confidence: 0,
      recommendation: "reject",
      signals: [{ name: "same_language", weight: 0, detail: `both ${normLang(a.language)}` }],
    };
  }

  if (a.ccli_song_id && a.ccli_song_id === b.ccli_song_id) {
    signals.push({ name: "shared_ccli", weight: WEIGHTS.sharedCcli, detail: a.ccli_song_id });
  }
  if (a.tono_work_id && a.tono_work_id === b.tono_work_id) {
    signals.push({ name: "shared_tono", weight: WEIGHTS.sharedTono, detail: a.tono_work_id });
  }

  const bible = jaccard(a.bible_refs, b.bible_refs);
  if (bible.union > 0 && bible.score > 0) {
    signals.push({ name: "bible_refs", weight: WEIGHTS.bibleRefs * bible.score, detail: `${bible.shared}/${bible.union} refs` });
  }

  const themes = jaccard(a.themes, b.themes);
  if (themes.union > 0 && themes.score > 0) {
    signals.push({ name: "themes", weight: WEIGHTS.themes * themes.score, detail: `${themes.shared}/${themes.union} themes` });
  }

  if (overlaps(a.composer_ids, b.composer_ids)) {
    signals.push({ name: "shared_composer", weight: WEIGHTS.sharedComposer });
  }

  if (typeof a.year_first_published === "number" && typeof b.year_first_published === "number") {
    if (Math.abs(a.year_first_published - b.year_first_published) <= YEAR_WINDOW) {
      signals.push({ name: "year_proximity", weight: WEIGHTS.yearProximity });
    }
  }

  const title = titleTokenSimilarity(a.canonical_title, b.canonical_title);
  if (title > 0) {
    signals.push({ name: "title_tokens", weight: WEIGHTS.titleTokens * title });
  }

  const confidence = clamp01(signals.reduce((sum, s) => sum + s.weight, 0));
  return { a_id: a.id, b_id: b.id, confidence, recommendation: recommend(confidence), signals };
}

/** Rank a pool of candidate songs against a target, best-first. */
export function proposeCandidates(
  target: MatchSong,
  pool: MatchSong[],
  opts: { minConfidence?: number } = {},
): CandidateScore[] {
  const min = opts.minConfidence ?? PROPOSE_AT;
  return pool
    .filter((s) => s.id !== target.id)
    .map((s) => scoreTranslationCandidate(target, s))
    .filter((c) => c.recommendation !== "reject" && c.confidence >= min)
    .sort((x, y) => y.confidence - x.confidence || x.b_id.localeCompare(y.b_id));
}

function recommend(confidence: number): Recommendation {
  if (confidence >= AUTO_LINK_AT) return "auto_link";
  if (confidence >= PROPOSE_AT) return "propose";
  return "reject";
}

// ── helpers ───────────────────────────────────────────────────────────────────

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, Number(n.toFixed(4))));
}

interface JaccardResult { score: number; shared: number; union: number; }

function jaccard(a: string[] | undefined, b: string[] | undefined): JaccardResult {
  const sa = new Set((a ?? []).map((x) => x.toLowerCase().trim()).filter(Boolean));
  const sb = new Set((b ?? []).map((x) => x.toLowerCase().trim()).filter(Boolean));
  if (sa.size === 0 || sb.size === 0) return { score: 0, shared: 0, union: 0 };
  let shared = 0;
  for (const x of sa) if (sb.has(x)) shared += 1;
  const union = sa.size + sb.size - shared;
  return { score: union === 0 ? 0 : shared / union, shared, union };
}

function overlaps(a: string[] | undefined, b: string[] | undefined): boolean {
  if (!a || !b) return false;
  const sb = new Set(b);
  return a.some((x) => sb.has(x));
}

const STOPWORDS = new Set([
  "the", "and", "you", "your", "are", "our", "for", "with", "his", "her",
  "og", "det", "den", "som", "har", "til", "jeg", "deg", "din", "ditt",
  "och", "att", "som", "har", "till", "jag", "dig", "din",
]);

/** Fuzzy token Jaccard — counts near-identical cognates (Hallelujah/Halleluja). */
function titleTokenSimilarity(a: string, b: string): number {
  const ta = tokenize(a);
  const tb = tokenize(b);
  if (ta.length === 0 || tb.length === 0) return 0;
  const used = new Set<number>();
  let shared = 0;
  for (const x of ta) {
    for (let j = 0; j < tb.length; j++) {
      if (used.has(j)) continue;
      if (tokensMatch(x, tb[j]!)) { shared += 1; used.add(j); break; }
    }
  }
  const union = ta.length + tb.length - shared;
  return union === 0 ? 0 : shared / union;
}

function tokenize(title: string): string[] {
  return title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}

function tokensMatch(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length >= 4 && b.length >= 4 && Math.abs(a.length - b.length) <= 1) {
    return levenshtein(a, b) <= 1;
  }
  return false;
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  let curr = new Array<number>(n + 1).fill(0);
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j]! + 1, curr[j - 1]! + 1, prev[j - 1]! + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n]!;
}
