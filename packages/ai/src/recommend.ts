/**
 * Recommendation ranking (Phase 4.3).
 *
 * The retrieval (embed the request, pull nearest songs) happens in the API
 * against the catalog; this module is the pure ranker + explainer that turns
 * candidates into an ordered, reasoned set. Grounding picks in *our* catalog
 * (songs the church can actually license and use) is the whole value-add over
 * "ask a chatbot". A hosted LLM can later re-rank these, but the catalog
 * grounding and the explanations live here and stay testable.
 */

export interface RecommendRequest {
  theme?: string;
  scripture?: string;
  description?: string;
  arc?: "rising" | "reflective" | "celebration" | "lament";
  duration_min?: number;
  language?: string;
}

export interface Candidate {
  id: string;
  canonical_title: string;
  themes: string[];
  bible_refs: string[];
  popularity_score: number;
  language: string;
  /** Cosine similarity from the embedding retrieval, 0..1. */
  semantic_score: number;
  suggested_key?: string | null;
}

export interface RankedPick {
  song_id: string;
  title: string;
  score: number;
  reason: string;
  suggested_key?: string | null;
}

export interface RankResult {
  picks: RankedPick[];
  total_minutes_estimate: number;
  summary: string;
}

const MIN_PER_SONG = 4; // rough average worship-song length

const norm = (s: string) => s.toLowerCase().trim();

/** Does the requested theme appear in the song's themes (loose contains both ways)? */
function themeHit(req: RecommendRequest, c: Candidate): boolean {
  if (!req.theme) return false;
  const t = norm(req.theme);
  return c.themes.some((x) => norm(x).includes(t) || t.includes(norm(x)));
}

function scriptureHit(req: RecommendRequest, c: Candidate): boolean {
  if (!req.scripture) return false;
  const s = norm(req.scripture);
  return c.bible_refs.some((x) => norm(x).includes(s) || s.includes(norm(x)));
}

/** Combined 0..1 score + the human reason for the pick. */
export function scoreCandidate(req: RecommendRequest, c: Candidate): { score: number; reason: string } {
  let score = 0.6 * c.semantic_score;
  const reasons: string[] = [];

  if (themeHit(req, c)) {
    score += 0.25;
    reasons.push(`fits the theme of ${req.theme}`);
  }
  if (scriptureHit(req, c)) {
    score += 0.2;
    reasons.push(`grounded in ${req.scripture}`);
  }
  // popularity is a gentle tiebreaker (squashed into 0..0.1).
  score += 0.1 * Math.min(1, c.popularity_score / 100);

  if (reasons.length === 0) {
    reasons.push(c.semantic_score > 0.15 ? "semantically close to your request" : "a catalog match worth considering");
  }
  if (c.themes.length) reasons.push(`themes: ${c.themes.slice(0, 3).join(", ")}`);

  const reason = reasons.join(" · ").replace(/^./, (ch) => ch.toUpperCase());
  return { score: Math.min(1, score), reason };
}

/** Order picks for the requested energy arc (best-effort, popularity as proxy). */
function arcOrder(picks: RankedPick[], arc: RecommendRequest["arc"]): RankedPick[] {
  if (!arc) return picks;
  // We don't have per-song energy yet, so use score as a stand-in: "rising"
  // builds toward the strongest pick, "reflective"/"lament" wind down from it.
  const byScore = [...picks].sort((a, b) => a.score - b.score);
  if (arc === "rising" || arc === "celebration") return byScore;
  return byScore.reverse();
}

/**
 * Rank candidates and, when a duration is given, pack a set that fills it.
 * Without a duration we return the top handful.
 */
export function rankPicks(req: RecommendRequest, candidates: Candidate[]): RankResult {
  const pool = candidates
    .filter((c) => !req.language || c.language === req.language)
    .map((c) => {
      const { score, reason } = scoreCandidate(req, c);
      return { pick: { song_id: c.id, title: c.canonical_title, score, reason, suggested_key: c.suggested_key ?? null }, score };
    })
    .sort((a, b) => b.score - a.score)
    .map((x) => x.pick);

  let chosen: RankedPick[];
  if (req.duration_min && req.duration_min > 0) {
    const target = Math.max(1, Math.round(req.duration_min / MIN_PER_SONG));
    chosen = pool.slice(0, target);
  } else {
    chosen = pool.slice(0, 5);
  }
  chosen = arcOrder(chosen, req.arc);

  const minutes = chosen.length * MIN_PER_SONG;
  const focus = req.theme ?? req.scripture ?? req.description ?? "your request";
  const summary =
    chosen.length === 0
      ? "No catalog songs matched closely enough — try a broader theme or remove the language filter."
      : `${chosen.length} songs for ${focus}` +
        (req.arc ? `, arranged for a ${req.arc} arc` : "") +
        `, ~${minutes} min. All are real catalog entries you can license and use.`;

  return { picks: chosen, total_minutes_estimate: minutes, summary };
}
