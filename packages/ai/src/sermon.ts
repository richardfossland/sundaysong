/**
 * Sermon-to-Setlist extraction (Phase 4.x, AI tier).
 *
 * A worship leader has next Sunday's sermon manuscript (or just the preaching
 * texts) and wants a set that *serves the sermon* — songs whose themes,
 * scripture and energy arc carry the message. This module turns that free text
 * into a structured `SermonExtract` (themes, scripture refs, an energy arc and
 * keywords) which the existing recommendation pipeline (embed → nearestSongs →
 * rankPicks → applyArc → rerankPicks) then turns into a real, catalog-grounded
 * set.
 *
 * Same seam as `rerank.ts` / `translate.ts`: the prompt builder and response
 * parser are PURE and unit-tested with canned fixtures; the single
 * `client.complete` call sits behind the `LlmClient` seam. Crucially, unlike
 * translation, this DEGRADES GRACEFULLY with NO key: `extractSermon(req, null)`
 * (or any LLM failure) falls back to `heuristicExtract`, a keyword-only
 * extractor that still produces a usable `SermonExtract`, so the full pipeline
 * always returns a set even on the free tier.
 *
 * The LLM only SUGGESTS: every field it returns is validated/clamped against a
 * strict schema (`parseSermonResponse`) before it touches the engine, and the
 * downstream ranker stays grounded in the real catalog — the model can never
 * surface a song the church can't license.
 */

import type { LlmClient } from "./llm";
import type { RecommendRequest } from "./recommend";

/** The energy arc the engine understands (mirrors RecommendRequest["arc"]). */
export type SermonArc = NonNullable<RecommendRequest["arc"]>;
const VALID_ARCS: readonly SermonArc[] = ["rising", "reflective", "celebration", "lament"];

export interface SermonExtract {
  /** Short thematic phrases, e.g. "grace", "the prodigal son", "God's faithfulness". */
  themes: string[];
  /** Scripture references, e.g. "Luke 15:11-32", "Psalm 23". */
  scripture: string[];
  /** Suggested energy arc for the service, or null when the text gives no signal. */
  arc: SermonArc | null;
  /** Salient keywords for semantic retrieval (broader than themes). */
  keywords: string[];
  /** One-sentence summary of the sermon's thrust (for the planner; never doctrine). */
  summary: string;
  /** "llm" when the model produced this, "heuristic" on the keyless / fallback path. */
  source: "llm" | "heuristic";
}

export interface SermonExtractRequest {
  /** The sermon manuscript / notes / outline. Free text. */
  manuscript?: string;
  /** Explicit scripture references the leader already knows, e.g. ["Luke 15"]. */
  scripture_refs?: string[];
  /** Title or one-line of the sermon, optional. */
  title?: string;
  /** Preferred response/UX language for the summary (Norwegian-first). */
  language?: string;
}

// ── Scripture detection (pure) ────────────────────────────────────────────────

/**
 * Book names we recognise for the heuristic scripture sweep — English plus the
 * Norwegian Bible-book forms a church leader is likely to type. Not exhaustive
 * (the LLM path is far broader); this is the safety net for the keyless tier.
 */
const BIBLE_BOOKS = [
  // English
  "Genesis", "Exodus", "Leviticus", "Numbers", "Deuteronomy", "Joshua", "Judges", "Ruth",
  "Samuel", "Kings", "Chronicles", "Ezra", "Nehemiah", "Esther", "Job", "Psalm", "Psalms",
  "Proverbs", "Ecclesiastes", "Song of Songs", "Isaiah", "Jeremiah", "Lamentations", "Ezekiel",
  "Daniel", "Hosea", "Joel", "Amos", "Obadiah", "Jonah", "Micah", "Nahum", "Habakkuk",
  "Zephaniah", "Haggai", "Zechariah", "Malachi", "Matthew", "Mark", "Luke", "John", "Acts",
  "Romans", "Corinthians", "Galatians", "Ephesians", "Philippians", "Colossians",
  "Thessalonians", "Timothy", "Titus", "Philemon", "Hebrews", "James", "Peter", "Jude",
  "Revelation",
  // Norwegian forms
  "Salme", "Salmene", "Salmenes", "Matteus", "Markus", "Lukas", "Johannes", "Apostlenes",
  "Romerne", "Korinter", "Korinterne", "Galaterne", "Efeserne", "Filipperne", "Kolosserne",
  "Tessaloniker", "Hebreerne", "Jakob", "Peters", "Johannes’",
  "Mosebok", "Josva", "Dommerne", "Ordspåkene", "Forkynneren", "Jesaja", "Jeremia",
  "Klagesangene", "Esekiel", "Åpenbaringen",
];

/**
 * Pull scripture references out of free text. Pure, conservative: matches a
 * (optional leading ordinal) book name optionally followed by a chapter[:verse]
 * range. Deduped, capped, original casing preserved.
 */
export function extractScriptureRefs(text: string): string[] {
  if (!text) return [];
  // (1 |2 |3 |I |II |III |Forste |Andre )? Book (chapter(:verse)?(-range)?)?
  const ordinal = "(?:[123]\\.?\\s+|I{1,3}\\s+|F\\u00f8rste\\s+|Andre\\s+|Tredje\\s+)?";
  const book = `(?:${BIBLE_BOOKS.map((b) => b.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`;
  const cv = "(?:\\s+\\d{1,3}(?:[:,.]\\d{1,3})?(?:\\s*[-–]\\s*\\d{1,3}(?:[:,.]\\d{1,3})?)?)?";
  const re = new RegExp(`${ordinal}${book}${cv}`, "gi");
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(re)) {
    const ref = m[0].replace(/\s+/g, " ").trim();
    const key = ref.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(ref);
    }
    if (out.length >= 12) break;
  }
  return out;
}

// ── Keyword / theme heuristic (pure) ───────────────────────────────────────────

/** Words too common to be a theme. English + Norwegian closed-class words. */
const STOPWORDS = new Set(
  (
    "the a an and or but of to in on for with as at by from is are was were be been being this that " +
    "these those it its we you they he she his her our your their not no so if then than will would can " +
    "could should may might do does did have has had what which who whom whose when where why how all any " +
    "og i på av til en et er var det den de vi du dere han hun som med for at om ut inn opp ned " +
    "ikke men eller så da når hva hvem hvor hvorfor hvordan være bli blir har hadde skal " +
    "vil kan kunne bør må sin sitt sine vår vårt våre deres"
  ).split(/\s+/),
);

/**
 * Theme/keyword candidates: lowercase word tokens (incl. Nordic letters),
 * length >= 4, not a stopword, ranked by frequency. Pure + deterministic.
 */
export function keywordCandidates(text: string, max = 12): string[] {
  if (!text) return [];
  const counts = new Map<string, number>();
  for (const raw of text.toLowerCase().split(/[^a-zæøåäöü]+/)) {
    if (raw.length < 4 || STOPWORDS.has(raw)) continue;
    counts.set(raw, (counts.get(raw) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, max)
    .map(([w]) => w);
}

/** Heuristic arc guess from mood words. Returns null when ambiguous. */
export function guessArc(text: string): SermonArc | null {
  const t = text.toLowerCase();
  const score: Record<SermonArc, number> = { rising: 0, celebration: 0, reflective: 0, lament: 0 };
  const hit = (arc: SermonArc, words: string[]) => {
    for (const w of words) if (t.includes(w)) score[arc] += 1;
  };
  hit("celebration", ["resurrect", "risen", "victory", "triumph", "rejoice", "celebrate", "praise", "oppstand", "seier", "jubl", "feir", "lovpris"]);
  hit("rising", ["hope", "call", "send", "mission", "go ", "rise", "build", "håp", "kall", "utsend", "misjon", "reis"]);
  hit("lament", ["lament", "grief", "mourn", "sorrow", "suffer", "cross", "death", "sin ", "klage", "sorg", "lidels", "kors", "død", "synd"]);
  hit("reflective", ["repent", "quiet", "still", "wait", "rest", "contempl", "reflect", "anger", "omvend", "stille", "vent", "hvile", "ettertank"]);
  let best: SermonArc | null = null;
  let bestN = 0;
  for (const arc of VALID_ARCS) {
    if (score[arc] > bestN) {
      bestN = score[arc];
      best = arc;
    }
  }
  return best;
}

/**
 * Keyword-only extraction — the keyless / fallback path. Pure. Produces a real
 * `SermonExtract` so the downstream pipeline still returns a set with no API
 * key (and when the LLM call fails). Themes are the top keywords; scripture is
 * the union of any explicit refs and refs swept from the manuscript.
 */
export function heuristicExtract(req: SermonExtractRequest): SermonExtract {
  const text = [req.title, req.manuscript].filter(Boolean).join("\n").trim();
  const sweptRefs = extractScriptureRefs(text);
  const scripture = dedupe([...(req.scripture_refs ?? []).map((s) => s.trim()).filter(Boolean), ...sweptRefs]).slice(0, 12);
  const keywords = keywordCandidates(text, 12);
  const themes = keywords.slice(0, 6);
  const arc = guessArc(text);
  const summaryFocus = themes[0] ?? scripture[0] ?? req.title ?? "preken";
  return {
    themes,
    scripture,
    arc,
    keywords,
    summary: `Stikkordbasert utdrag (ingen AI-nøkkel) rundt «${summaryFocus}».`,
    source: "heuristic",
  };
}

function dedupe(xs: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of xs) {
    const k = x.toLowerCase();
    if (x && !seen.has(k)) {
      seen.add(k);
      out.push(x);
    }
  }
  return out;
}

// ── LLM path (prompt + parse are pure; the call is the only side effect) ────────

export const SERMON_SYSTEM_PROMPT =
  "Du er en assistent for gudstjenesteplanlegging. Du får et prekenmanus eller prekentekster og skal " +
  "trekke ut det som trengs for å finne lovsanger som tjener forkynnelsen: temaer, bibelreferanser, " +
  "en energibue for gudstjenesten, og søkeord. Du foreslår KUN — du dikter aldri opp lære og " +
  "kommenterer ikke teologien; du oppsummerer nøkternt. Svar med KUN et JSON-objekt, ingen tekst før eller etter.";

/** Build the user message. Pure. Embeds any explicit refs the leader supplied. */
export function buildSermonPrompt(req: SermonExtractRequest): string {
  const lang = req.language || "no";
  return [
    "Analyser denne prekenen og trekk ut det som trengs for å velge lovsanger.",
    req.title ? `Tittel: ${req.title}` : null,
    req.scripture_refs?.length ? `Oppgitte tekster: ${req.scripture_refs.join("; ")}` : null,
    "",
    "Manus / notater:",
    (req.manuscript ?? "").slice(0, 16000) || "(ingen)",
    "",
    "Returner JSON nøyaktig på denne formen:",
    "{",
    '  "themes": ["<kort tema>", ...],',
    '  "scripture": ["<bibelreferanse, f.eks. Lukas 15:11-32>", ...],',
    '  "arc": "rising" | "reflective" | "celebration" | "lament" | null,',
    '  "keywords": ["<søkeord>", ...],',
    `  "summary": "<én setning som oppsummerer prekenens hovedpoeng, på ${lang}>"`,
    "}",
    "Bruk 3–6 temaer og opptil 12 søkeord. Velg energibue ut fra prekenens stemning " +
      "(oppstandelse/seier = celebration; kall/sendelse/håp = rising; bot/stillhet = reflective; " +
      "sorg/lidelse/kors = lament); bruk null hvis uklart. Finn bare opp bibelreferanser som faktisk står i teksten.",
  ]
    .filter((x) => x !== null)
    .join("\n");
}

/** First balanced JSON object out of a model reply (tolerates fences/prose). */
function extractJsonObject(raw: string): string | null {
  const start = raw.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < raw.length; i++) {
    const ch = raw[i]!;
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return raw.slice(start, i + 1);
    }
  }
  return null;
}

const asStringList = (v: unknown, cap: number): string[] => {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const x of v) {
    if (typeof x === "string") {
      const s = x.trim();
      if (s && !seen.has(s.toLowerCase())) {
        seen.add(s.toLowerCase());
        out.push(s);
      }
    }
    if (out.length >= cap) break;
  }
  return out;
};

/**
 * Parse + validate the model reply against the strict `SermonExtract` schema.
 * Every field is sanitised: lists are string-only/deduped/capped, `arc` is
 * clamped to the four valid arcs (else null), and a blank/garbage result yields
 * `null` so the caller falls back to the heuristic. Pure. `source` is "llm".
 */
export function parseSermonResponse(raw: string): SermonExtract | null {
  const json = extractJsonObject(raw);
  if (!json) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const obj = parsed as Record<string, unknown>;

  const themes = asStringList(obj.themes, 8);
  const scripture = asStringList(obj.scripture, 12);
  const keywords = asStringList(obj.keywords, 16);
  const arc = typeof obj.arc === "string" && (VALID_ARCS as readonly string[]).includes(obj.arc) ? (obj.arc as SermonArc) : null;
  const summary = typeof obj.summary === "string" ? obj.summary.trim() : "";

  // Need at least something to anchor retrieval on, or it is not usable.
  if (themes.length === 0 && scripture.length === 0 && keywords.length === 0) return null;

  return { themes, scripture, arc, keywords, summary, source: "llm" };
}

/**
 * Extract sermon themes/scripture/arc/keywords. When a client is given, run the
 * LLM and validate its reply; on a missing client, an LLM error, or an unusable
 * reply, DEGRADE to `heuristicExtract`. Never throws on the AI path — the core
 * flow (a recommended set) must always proceed. Pass `client` as
 * `getLlmClient()`; when it is `null`, this is exactly the keyword heuristic.
 */
export async function extractSermon(req: SermonExtractRequest, client: LlmClient | null): Promise<SermonExtract> {
  if (!client) return heuristicExtract(req);
  try {
    const raw = await client.complete([{ role: "user", content: buildSermonPrompt(req) }], {
      system: SERMON_SYSTEM_PROMPT,
      temperature: 0,
      maxTokens: 1024,
    });
    const parsed = parseSermonResponse(raw);
    if (!parsed) return heuristicExtract(req);
    // Fold in any explicit refs the leader supplied that the model missed, and
    // sweep the manuscript as a backstop — the engine wants every real ref.
    const text = [req.title, req.manuscript].filter(Boolean).join("\n");
    const merged = dedupe([...parsed.scripture, ...(req.scripture_refs ?? []), ...extractScriptureRefs(text)]).slice(0, 12);
    return { ...parsed, scripture: merged };
  } catch {
    return heuristicExtract(req);
  }
}

/**
 * Project a `SermonExtract` onto a `RecommendRequest` for the existing pipeline.
 * Themes + keywords + scripture become the retrieval query/signals. Pure.
 *  - `theme`: the lead theme (the ranker also boosts theme hits).
 *  - `scripture`: the lead reference.
 *  - `description`: themes + keywords joined, so the embedder gets full signal.
 *  - `arc`: carried through for energy sequencing.
 */
export function sermonToRecommendRequest(
  extract: SermonExtract,
  opts: { language?: string; duration_min?: number } = {},
): RecommendRequest {
  const description = dedupe([...extract.themes, ...extract.keywords]).join(", ");
  return {
    theme: extract.themes[0],
    scripture: extract.scripture[0],
    description: description || undefined,
    arc: extract.arc ?? undefined,
    language: opts.language,
    duration_min: opts.duration_min,
  };
}
