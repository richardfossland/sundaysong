/**
 * Recommendation use case C — "songs that fit a liturgical season".
 *
 * Given a liturgical season (Advent, Christmas, Lent, Easter, …), score catalog
 * candidates by how thematically relevant they are to that season. Scoring is
 * pure and offline: it matches each candidate's themes and title against a
 * curated set of season keywords plus the semantic score from an embed query.
 *
 * This allows the route to:
 *  1. Embed a season-specific query string and retrieve semantically close songs
 *     from pgvector (the retrieval step, in the route).
 *  2. Pass the retrieved candidates here for keyword-boosted re-scoring so that,
 *     e.g., "Joy to the World" is boosted for Christmas even if its embedding
 *     vector is ambiguous.
 *
 * Pure, deterministic, no LLM required. Degrades gracefully if no themes are
 * present (semantic score alone carries the ranking).
 */

import type { LiturgicalSeason } from "@sundaysong/shared";

// ── Season definitions ────────────────────────────────────────────────────────

/**
 * Curated keyword sets for each season.  These are matched case-insensitively
 * against a candidate's `themes` array and `canonical_title`.  The `query`
 * string is used by the route to generate the retrieval embedding (no LLM).
 *
 * Keywords are deliberately broad so that songs that don't use the exact
 * liturgical jargon (e.g. Nordic hymns that talk about "light in darkness"
 * rather than "Advent") still score well.
 */
export interface SeasonDefinition {
  /** Human-readable name for summaries. */
  name: string;
  /** Short Norwegian name (for i18n in summaries). */
  nameNo: string;
  /** Query to embed for semantic retrieval. */
  query: string;
  /**
   * Primary keywords — strong boost (0.3 each, max 0.6 total from this tier).
   * Match against themes[] and title.
   */
  primaryKeywords: string[];
  /**
   * Secondary keywords — gentle boost (0.15 each, max 0.3 total from this tier).
   */
  secondaryKeywords: string[];
  /** One-sentence human description used in the summary. */
  description: string;
}

export const SEASON_DEFINITIONS: Record<LiturgicalSeason, SeasonDefinition> = {
  Advent: {
    name: "Advent",
    nameNo: "Advent",
    query: "Advent waiting hope preparation coming of Christ darkness light",
    primaryKeywords: ["advent", "waiting", "come lord jesus", "maranatha", "prepare", "hope", "expectation"],
    secondaryKeywords: ["darkness", "light", "candle", "prophecy", "promise", "longing", "watchfulness", "veni"],
    description: "Advent — a season of waiting, hope, and preparation for Christmas.",
  },
  Christmas: {
    name: "Christmas",
    nameNo: "Jul",
    query: "Christmas nativity incarnation Emmanuel God with us joy celebration birth Jesus",
    primaryKeywords: ["christmas", "nativity", "incarnation", "emmanuel", "born", "bethlehem", "noel", "jul", "juledag"],
    secondaryKeywords: ["angels", "shepherds", "manger", "gloria", "hallelujah", "joy", "saviour", "immanuel", "peace on earth"],
    description: "Christmas — celebrating the incarnation and birth of Jesus Christ.",
  },
  Epiphany: {
    name: "Epiphany",
    nameNo: "Epifani",
    query: "Epiphany wise men light nations revelation manifestation star",
    primaryKeywords: ["epiphany", "wise men", "magi", "star", "light to nations", "manifestation"],
    secondaryKeywords: ["nations", "gentiles", "revelation", "glory", "east", "baptism", "beginning ministry"],
    description: "Epiphany — the revealing of Christ to the world, from the Magi to the nations.",
  },
  Lent: {
    name: "Lent",
    nameNo: "Faste",
    query: "Lent repentance fasting prayer humility surrender cross sacrifice",
    primaryKeywords: ["lent", "repentance", "fasting", "ashes", "humility", "wilderness", "temptation"],
    secondaryKeywords: ["sacrifice", "surrender", "cross", "suffering", "prayer", "confession", "mercy", "forgiveness", "kyrie"],
    description: "Lent — a season of repentance, fasting, and drawing closer to God.",
  },
  HolyWeek: {
    name: "Holy Week",
    nameNo: "Stille uke",
    query: "Holy Week Palm Sunday passion crucifixion suffering servant Gethsemane",
    primaryKeywords: ["holy week", "palm sunday", "crucifixion", "passion", "gethsemane", "hosanna"],
    secondaryKeywords: ["cross", "suffering servant", "betrayal", "via crucis", "stations of the cross", "broken bread", "blood", "sacrifice"],
    description: "Holy Week — walking with Jesus through Palm Sunday to Good Friday.",
  },
  Easter: {
    name: "Easter",
    nameNo: "Påske",
    query: "Easter resurrection risen alive victory death defeated alleluia celebration new life",
    primaryKeywords: ["easter", "resurrection", "risen", "alleluia", "hallelujah", "empty tomb", "he lives"],
    secondaryKeywords: ["victory", "death defeated", "new life", "glory", "praise", "celebrate", "alive", "ascension"],
    description: "Easter — celebrating the resurrection of Jesus Christ and new life.",
  },
  Pentecost: {
    name: "Pentecost",
    nameNo: "Pinse",
    query: "Pentecost Holy Spirit fire wind come spirit power church mission",
    primaryKeywords: ["pentecost", "holy spirit", "spirit come", "fire", "wind", "breath of god", "veni sancte spiritus"],
    secondaryKeywords: ["power", "tongues", "mission", "send me", "dove", "anointing", "move of god", "revival"],
    description: "Pentecost — the coming of the Holy Spirit and the birth of the church.",
  },
  Trinity: {
    name: "Trinity",
    nameNo: "Treenighet",
    query: "Trinity Father Son Holy Spirit triune God glory doxology",
    primaryKeywords: ["trinity", "triune", "father son spirit", "three in one", "godhead", "doxology"],
    secondaryKeywords: ["creator", "redeemer", "sustainer", "glory", "holy holy holy", "sanctus", "majesty"],
    description: "Trinity Sunday — worshipping the triune God: Father, Son, and Holy Spirit.",
  },
  AllSaints: {
    name: "All Saints",
    nameNo: "Allehelgen",
    query: "All Saints cloud of witnesses saints departed eternal life resurrection hope",
    primaryKeywords: ["all saints", "saints", "cloud of witnesses", "departed", "remembrance", "allehelgen"],
    secondaryKeywords: ["eternal life", "resurrection hope", "communion of saints", "those who have gone before", "faithful departed", "heaven"],
    description: "All Saints — remembering the faithful departed and the communion of saints.",
  },
  OrdinaryTime: {
    name: "Ordinary Time",
    nameNo: "Alminnelig tid",
    query: "ordinary time discipleship growth faith community worship everyday following Jesus",
    primaryKeywords: ["discipleship", "follow", "faith", "community", "growth", "everyday", "ordinary"],
    secondaryKeywords: ["worship", "trust", "walk with god", "stewardship", "service", "love", "kingdom", "church"],
    description: "Ordinary Time — seasons of growth, discipleship, and everyday faith.",
  },
};

// ── Scoring ───────────────────────────────────────────────────────────────────

const PRIMARY_BOOST = 0.3;
const PRIMARY_MAX = 0.6;
const SECONDARY_BOOST = 0.15;
const SECONDARY_MAX = 0.3;
const SEMANTIC_WEIGHT = 0.5;

/** Candidate passed to `rankSeason` for scoring. */
export interface SeasonCandidate {
  id: string;
  title: string;
  themes: string[];
  language?: string;
  /** Semantic similarity from embedding retrieval (0..1, 0 when not available). */
  semantic_score: number;
}

export interface SeasonPick {
  song_id: string;
  title: string;
  /** Final 0..1 score. */
  score: number;
  /** Why this song fits the season. */
  reason: string;
}

export interface RankSeasonResult {
  picks: SeasonPick[];
}

const norm = (s: string) => s.toLowerCase().trim();

/** Count matching keywords from a list, returning total and matched keyword names. */
function matchKeywords(text: string[], keywords: string[]): { count: number; matched: string[] } {
  const combined = text.map(norm).join(" ");
  const matched: string[] = [];
  for (const kw of keywords) {
    if (combined.includes(norm(kw))) {
      matched.push(kw);
    }
  }
  return { count: matched.length, matched };
}

/**
 * Score and rank `candidates` for how well they fit `season`.
 * Pure, offline, no LLM.
 *
 * Final score formula:
 *   semantic   = SEMANTIC_WEIGHT × semantic_score
 *   primary    = min(PRIMARY_MAX,  primaryMatches × PRIMARY_BOOST)
 *   secondary  = min(SECONDARY_MAX, secondaryMatches × SECONDARY_BOOST)
 *   score      = min(1, semantic + primary + secondary)
 */
export function rankSeason(
  season: LiturgicalSeason,
  candidates: SeasonCandidate[],
  limit = 5,
): RankSeasonResult {
  const def = SEASON_DEFINITIONS[season];

  const scored = candidates.map((c) => {
    const searchTargets = [c.title, ...c.themes];

    const pri = matchKeywords(searchTargets, def.primaryKeywords);
    const sec = matchKeywords(searchTargets, def.secondaryKeywords);

    const semanticComponent = SEMANTIC_WEIGHT * c.semantic_score;
    const primaryComponent = Math.min(PRIMARY_MAX, pri.count * PRIMARY_BOOST);
    const secondaryComponent = Math.min(SECONDARY_MAX, sec.count * SECONDARY_BOOST);

    const raw = semanticComponent + primaryComponent + secondaryComponent;
    const score = Math.min(1, Math.round(raw * 1000) / 1000);

    // Build a human reason
    const reasons: string[] = [];
    if (pri.matched.length > 0) {
      reasons.push(`season themes: ${pri.matched.slice(0, 3).join(", ")}`);
    } else if (sec.matched.length > 0) {
      reasons.push(`related themes: ${sec.matched.slice(0, 3).join(", ")}`);
    }
    if (c.semantic_score > 0.15) {
      reasons.push("semantically close to this season");
    }
    if (reasons.length === 0) {
      reasons.push(`catalog match for ${def.name}`);
    }
    const reason = reasons.join(" · ");

    return { c, score, reason };
  });

  scored.sort((a, b) => b.score - a.score);

  const picks: SeasonPick[] = scored.slice(0, limit).map(({ c, score, reason }) => ({
    song_id: c.id,
    title: c.title,
    score,
    reason,
  }));

  return { picks };
}

/**
 * Build the summary string returned to the API caller.
 */
export function buildSeasonSummary(season: LiturgicalSeason, pickCount: number): string {
  const def = SEASON_DEFINITIONS[season];
  if (pickCount === 0) {
    return `No catalog songs matched closely enough for ${def.name}. Try a broader catalog or check that songs have theme tags.`;
  }
  return `${pickCount} song${pickCount === 1 ? "" : "s"} for ${def.name}. ${def.description}`;
}
