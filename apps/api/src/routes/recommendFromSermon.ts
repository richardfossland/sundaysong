/**
 * POST /v1/recommend/from-sermon — "give me songs that serve next Sunday's sermon".
 *
 * Take a sermon manuscript and/or explicit scripture refs, extract the themes,
 * scripture, energy arc and keywords (Anthropic when a key is configured; a
 * keyword-only heuristic when not — see @sundaysong/ai `extractSermon`), then
 * feed that into the SAME retrieval + rank + arc pipeline /v1/recommend uses:
 * embed the extract → nearestSongs(pgvector) → rankPicks → applyArc → optional
 * LLM rerank. When a church licensing `profile` is given, each pick is annotated
 * with a CCLI/TONO coverage pill via `computeCoverage`.
 *
 * KEYLESS FALLBACK: with no ANTHROPIC_API_KEY the extraction degrades to the
 * keyword heuristic and `rerankPicks` collapses to the heuristic ranker — the
 * endpoint still returns a full, catalog-grounded set. The LLM only SUGGESTS
 * the extract; the engine (grounded in the real catalog) decides the songs.
 *
 * For offline unit tests, send `_picks` (a fully-hydrated pool) to bypass the
 * DB + embedder, mirroring /v1/recommend. That field is never set in production.
 *
 * INFRA-UNVERIFIED: the production path needs Postgres + pgvector (retrieval +
 * per-song key from variants); the extraction is unit-tested in @sundaysong/ai
 * and the route's rank/arc/coverage logic is unit-tested offline via `_picks`.
 */

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";

import { RecommendFromSermonRouteSchema, type Song } from "@sundaysong/shared";
import { getSql, nearestSongs, listSongs, listVariantsForSong, type NearestSong } from "@sundaysong/db";
import {
  getEmbedder,
  extractSermon,
  sermonToRecommendRequest,
  rerankPicks,
  applyArc,
  getLlmClient,
  type Candidate,
} from "@sundaysong/ai";
import { parseKey, type EnergySignals } from "@sundaysong/music";
import { computeCoverage, type CoverageSongInput } from "@sundaysong/licensing";

export const recommendFromSermonRoutes = new Hono();

recommendFromSermonRoutes.post("/", zValidator("json", RecommendFromSermonRouteSchema), async (c) => {
  const input = c.req.valid("json");

  // ── 1) Extract the sermon's themes / scripture / arc / keywords ────────────
  // LLM with a key, keyword heuristic without; never throws, always usable.
  const extract = await extractSermon(
    { manuscript: input.manuscript, scripture_refs: input.scripture_refs, title: input.title, language: input.language },
    getLlmClient(),
  );
  const req = sermonToRecommendRequest(extract, { language: input.language, duration_min: input.duration_min });

  // ── 2) Build the candidate pool (DB in production, `_picks` in tests) ──────
  let near: NearestSong[];
  const keysByPickId: Record<string, string | null> = {};
  const bpmByPickId: Record<string, number | null> = {};

  if (input._picks) {
    near = input._picks.map((p) => ({ ...(p.song as unknown as Song), score: p.semantic_score }));
    for (const p of input._picks) {
      keysByPickId[p.song.id] = p.key ?? null;
      bpmByPickId[p.song.id] = p.bpm ?? null;
    }
  } else {
    const sql = getSql();
    // Retrieval mirrors /v1/recommend: embed the extract when there's a signal,
    // else fall back to popular songs.
    const queryText = [req.theme, req.scripture, req.description].filter(Boolean).join(" ").trim();
    try {
      if (queryText) {
        const embedder = getEmbedder();
        const [qvec] = await embedder.embed([queryText]);
        near = await nearestSongs(sql, { vector: qvec!, k: 30, model_version: embedder.modelVersion, language: input.language });
      } else {
        const songs = await listSongs(sql, 30);
        near = songs.map((s) => ({ ...s, score: 0 }));
      }

      await Promise.all(
        near.map(async (n) => {
          const variants = await listVariantsForSong(sql, n.id);
          keysByPickId[n.id] = variants.find((v) => v.key)?.key ?? null;
          bpmByPickId[n.id] = variants.find((v) => v.bpm != null)?.bpm ?? null;
        }),
      );
    } catch (err) {
      return c.json({ error: "db_error", message: (err as Error).message }, 500);
    }
  }

  const candidates: Candidate[] = near.map((n) => ({
    id: n.id,
    canonical_title: n.canonical_title,
    themes: n.themes,
    bible_refs: n.bible_refs,
    popularity_score: Number(n.popularity_score),
    language: n.original_language,
    semantic_score: n.score,
  }));

  // ── 3) Rank (heuristic always; LLM rerank when a key is set) ───────────────
  const ranked = await rerankPicks(req, candidates, getLlmClient());

  // ── 4) Energy-arc sequencing (offline music-theory; no-op without an arc) ──
  let ordered = ranked;
  let arcApplied = false;
  if (req.arc) {
    const songById0 = new Map(near.map((n) => [n.id, n]));
    const signalsByPickId: Record<string, EnergySignals> = {};
    for (const p of ordered.picks) {
      const song = songById0.get(p.song_id);
      const keyStr = keysByPickId[p.song_id];
      signalsByPickId[p.song_id] = {
        bpm: bpmByPickId[p.song_id],
        key: keyStr ? parseKey(keyStr) : null,
        themes: song?.themes ?? [],
        title: song?.canonical_title ?? null,
      };
    }
    const arced = applyArc(ordered, { arc: req.arc, signalsByPickId });
    ordered = arced;
    arcApplied = arced.arcApplied;
  }

  // ── 5) Hydrate picks back to full songs + optional coverage pill ───────────
  const songById = new Map(near.map((n) => [n.id, n]));
  const picks = ordered.picks.map((p) => {
    const { score: _score, ...song } = songById.get(p.song_id)!;
    const out: {
      song: typeof song;
      reason: string;
      suggested_key?: string;
      coverage?: ReturnType<typeof computeCoverage>;
    } = { song, reason: p.reason, suggested_key: keysByPickId[p.song_id] ?? undefined };
    if (input.profile) {
      const s = song as unknown as Song;
      const coverageInput: CoverageSongInput = {
        id: s.id,
        canonical_title: s.canonical_title,
        copyright_status: s.copyright_status ?? "unknown",
        ccli_song_id: s.ccli_song_id ?? null,
        tono_work_id: s.tono_work_id ?? null,
        tono_registered: s.tono_registered ?? false,
        nordic_metadata: s.nordic_metadata ?? {},
      };
      out.coverage = computeCoverage(coverageInput, input.profile);
    }
    return out;
  });

  return c.json({
    extract: {
      themes: extract.themes,
      scripture: extract.scripture,
      arc: extract.arc,
      keywords: extract.keywords,
      summary: extract.summary,
      source: extract.source,
    },
    picks,
    total_minutes_estimate: ordered.total_minutes_estimate,
    summary: ordered.summary,
    reranked: ranked.reranked ?? false,
    arc: arcApplied ? req.arc : undefined,
  });
});
