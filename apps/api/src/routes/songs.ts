import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";

import type { z } from "zod";
import { SongSearchQuerySchema, SemanticSearchSchema, SongUploadInputSchema } from "@sundaysong/shared";

/** The validated body of `POST /v1/songs`, inferred from the shared schema. */
type SongUploadInput = z.infer<typeof SongUploadInputSchema>;
import type { Song, SongVariant } from "@sundaysong/shared";
import { getSql, getSong, getSongsByIds, listVariantsForSong, lyricistsForSong, searchSongsByTitle, translationsForSong, translationsForSongs, nearestSongs, upsertSongWithVariant } from "@sundaysong/db";
import { MeiliClient, SONG_INDEX, songToSearchDoc, rankDocs } from "@sundaysong/search";
import { getEmbedder } from "@sundaysong/ai";

/** A slim translation link as carried on a search/semantic hit. */
interface SlimTranslation {
  language: string;
  song_id: string;
  title: string;
}

/** A song with the related rows a search hit needs to render. */
interface SongWithRelations {
  song: Song;
  variants: SongVariant[];
  translations: SlimTranslation[];
}

/** The result the upload handler returns to the client. */
export interface SongUploadResult {
  song_id: string;
  variant_id: string;
  action: "added" | "updated";
  /** The Phase 8 moderation envelope id — the contribution enters the queue as `pending`. */
  upload_id?: string;
}

/**
 * The data access the `POST /v1/songs` upload handler needs. Production wires
 * the Postgres-backed implementation (`postgresUploadStore`); tests inject an
 * in-memory fake. This is the same dependency-injection seam the admin routes
 * use (`AdminStore`) — keeping the ingest behind it lets the upload → moderation
 * contract be exercised offline with no Postgres and no Meilisearch.
 */
export interface SongUploadStore {
  /**
   * Persist a user contribution: create the song + a `user_upload` variant and
   * open a Phase 8 moderation envelope (`pending`). Best-effort search indexing
   * is the implementation's concern, not the handler's.
   */
  upload(input: SongUploadInput): Promise<SongUploadResult>;
}

/**
 * The real store. Creates the song + variant via the idempotent ingest pipeline
 * with a moderation envelope, then indexes it best-effort so it's immediately
 * searchable. Postgres is the source of truth; if Meilisearch is down the
 * reindex worker catches it later.
 */
export function postgresUploadStore(): SongUploadStore {
  return {
    async upload(body) {
      const sql = getSql();
      const result = await upsertSongWithVariant(sql, {
        source_name: "user_upload",
        source_kind: "user_upload",
        source_external_id: crypto.randomUUID(),
        song: {
          canonical_title: body.title,
          original_language: body.language,
          copyright_status: body.copyright_status,
          year_first_published: body.year_first_published ?? null,
          themes: body.themes ?? [],
          bible_refs: body.bible_refs ?? [],
        },
        variant: {
          title: body.title,
          language: body.language,
          key: body.key ?? null,
          lyrics_excerpt: body.lyrics_excerpt ?? null,
          lyrics_url: body.lyrics_url ?? null,
          chord_chart_url: body.chord_chart_url ?? null,
          attribution_text: "User contribution",
        },
        lyricists: body.lyricists,
        // Open a Phase 8 moderation envelope so the contribution enters the admin
        // queue as `pending`. Per-user attribution lands with Sunday-account auth.
        upload: { submitted_by: "anonymous" },
      });

      // Index immediately so it shows up in search (best-effort — Postgres is the
      // source of truth; the reindex worker would catch it anyway if Meili is down).
      try {
        const song = await getSong(sql, result.song_id);
        if (song) {
          const variants = await listVariantsForSong(sql, result.song_id);
          await new MeiliClient().addDocuments(SONG_INDEX, [songToSearchDoc(song, variants)]);
        }
      } catch (err) {
        console.warn("[upload] meili index skipped:", err instanceof Error ? err.message : err);
      }

      return result;
    },
  };
}

/**
 * The data access the read handlers (`/search`, `/semantic-search`) need. Like
 * `SongUploadStore`, this is a dependency-injection seam: production wires the
 * Postgres-backed implementation (`postgresSearchStore`); tests inject an
 * in-memory fake so the Meilisearch path AND the offline Postgres fallback —
 * including the Nordic-aware re-ranking — can be exercised with no infra.
 */
export interface SongSearchStore {
  /** Resolve a batch of songs (with their relations) by id, preserving the input order. */
  hydrateByIds(ids: string[]): Promise<SongWithRelations[]>;
  /**
   * The offline fallback: trigram title search returning candidate songs with
   * their relations, windowed by (limit, offset) so the route can page. The
   * route re-ranks the returned candidates with the Nordic-aware scorer.
   */
  fallbackSearch(q: string, limit: number, offset?: number): Promise<SongWithRelations[]>;
}

/**
 * The real read store. Hydrates songs + variants + translations from Postgres.
 * `hydrateByIds` keeps the order of the ids it's given (so it preserves the
 * Meili relevance order); `fallbackSearch` returns trigram candidates that the
 * route then re-ranks.
 */
export function postgresSearchStore(): SongSearchStore {
  const hydrate = async (songs: Song[]): Promise<SongWithRelations[]> => {
    const sql = getSql();
    const translationsById = await translationsForSongs(sql, songs.map((s) => s.id));
    return Promise.all(
      songs.map(async (song) => ({
        song,
        variants: await listVariantsForSong(sql, song.id),
        translations: slimTranslations(translationsById.get(song.id) ?? []),
      })),
    );
  };

  return {
    async hydrateByIds(ids) {
      const sql = getSql();
      const byId = new Map((await getSongsByIds(sql, ids)).map((s) => [s.id, s]));
      // Index/DB drift can leave an id without a row — skip it rather than 500.
      const songs = ids.map((id) => byId.get(id)).filter((s): s is Song => s != null);
      return hydrate(songs);
    },
    async fallbackSearch(q, limit, offset = 0) {
      const sql = getSql();
      return hydrate(await searchSongsByTitle(sql, q, limit, offset));
    },
  };
}

export interface SongsRoutesDeps {
  /** The user-contribution ingest store. Defaults to the Postgres-backed one. */
  uploadStore?: SongUploadStore;
  /** The read store backing `/search` + `/semantic-search`. Defaults to Postgres. */
  searchStore?: SongSearchStore;
}

// Flatten translation rows into the lean shape search/semantic hits carry.
const slimTranslations = (links: Array<{ language: string; song_id: string; title: string }>) =>
  links.map((t) => ({ language: t.language, song_id: t.song_id, title: t.title }));

// Quote + escape a value for a Meilisearch filter (prevents filter injection).
const filterValue = (v: string) => `"${v.replace(/"/g, '\\"')}"`;

/**
 * Build the `/v1/songs` router. The upload handler is wired over an injected
 * `SongUploadStore` (defaulting to Postgres); the read handlers resolve their
 * SQL lazily via `getSql()`, so the router opens no connection at load time.
 */
export function createSongsRoutes(deps: SongsRoutesDeps = {}): Hono {
  const routes = new Hono();
  const uploadStore = deps.uploadStore ?? postgresUploadStore();
  const searchStore = deps.searchStore ?? postgresSearchStore();

// GET /v1/songs/search?q=&language=&themes=&page=&page_size=
routes.get("/search", zValidator("query", SongSearchQuerySchema), async (c) => {
  const q = c.req.valid("query");

  try {
    const filters: string[] = [];
    if (q.language) filters.push(`languages = ${filterValue(q.language)}`);
    if (q.themes?.length) filters.push(`themes IN [${q.themes.map(filterValue).join(", ")}]`);

    const meili = new MeiliClient();
    const res = await meili.search<{ id: string }>(SONG_INDEX, {
      q: q.q,
      filter: filters.length ? filters.join(" AND ") : undefined,
      limit: q.page_size,
      offset: q.page * q.page_size,
    });

    const ids = res.hits.map((h) => h.id);
    // Trust Meili's relevance order; emit a uniform score (the engine's ranking,
    // not ours, decided the order). `hydrateByIds` preserves that order.
    const hits = (await searchStore.hydrateByIds(ids)).map((h) => ({
      ...h,
      match_reason: "text" as const,
      score: 1,
    }));
    return c.json({ hits, total: res.estimatedTotalHits, page: q.page, page_size: q.page_size, engine: "meilisearch" });
  } catch {
    // Meilisearch unavailable → fall back to the Postgres trigram search so the
    // endpoint keeps working (degraded: no facets, no typo tolerance). We then
    // re-rank the candidates with the Nordic-aware scorer so the offline path
    // still orders by real title relevance (folding å/ø/æ etc.) and emits
    // genuine 0..1 scores instead of a flat trigram order with score:1.
    const candidates = await searchStore.fallbackSearch(q.q, q.page_size, q.page * q.page_size);
    const byId = new Map(candidates.map((h) => [h.song.id, h]));
    const docs = candidates.map((h) => songToSearchDoc(h.song, h.variants));
    const ranked = rankDocs(q.q, docs);
    const hits = ranked
      .map((r) => {
        const found = byId.get(r.doc.id);
        return found ? { ...found, match_reason: "text" as const, score: r.score } : null;
      })
      .filter((h): h is SongWithRelations & { match_reason: "text"; score: number } => h != null);
    return c.json({ hits, total: hits.length, page: q.page, page_size: q.page_size, engine: "postgres_fallback" });
  }
});

// POST /v1/songs/semantic-search
//   Embeds the query and finds the nearest songs via the pgvector HNSW index.
//   Run the embedding worker first (`pnpm embed`) so vectors exist.
routes.post("/semantic-search", zValidator("json", SemanticSearchSchema), async (c) => {
  const body = c.req.valid("json");
  const sql = getSql();
  const embedder = getEmbedder();

  const [qvec] = await embedder.embed([body.query]);
  const near = await nearestSongs(sql, {
    vector: qvec!,
    k: 20,
    model_version: embedder.modelVersion,
    language: body.language,
  });

  const translationsById = await translationsForSongs(sql, near.map((n) => n.id));
  const hits = await Promise.all(
    near.map(async (n) => {
      const { score, ...song } = n;
      return {
        song,
        variants: await listVariantsForSong(sql, song.id),
        translations: slimTranslations(translationsById.get(song.id) ?? []),
        match_reason: "semantic" as const,
        score,
        semantic_label: `Songs that mean something like “${body.query}”`,
      };
    }),
  );
  return c.json({ hits, query: body.query, model: embedder.modelVersion });
});

// POST /v1/songs — user contribution (Phase 8.1).
//   The contributor must declare they have the right to share. Delegates to the
//   injected upload store, which creates a song + a user_upload variant via the
//   idempotent ingest pipeline, opens a `pending` moderation envelope, and
//   best-effort indexes it for search. Per-user visibility lands with
//   Sunday-account auth.
routes.post("/", zValidator("json", SongUploadInputSchema), async (c) => {
  const body = c.req.valid("json");
  const result = await uploadStore.upload(body);
  return c.json(
    { song_id: result.song_id, variant_id: result.variant_id, action: result.action, upload_id: result.upload_id },
    201,
  );
});

// GET /v1/songs/:id
routes.get("/:id", async (c) => {
  const id = c.req.param("id");
  const sql = getSql();
  const song = await getSong(sql, id);
  if (!song) return c.json({ error: "not_found", id }, 404);
  const [variants, lyricists, translations] = await Promise.all([
    listVariantsForSong(sql, id),
    lyricistsForSong(sql, id),
    translationsForSong(sql, id),
  ]);
  return c.json({ ...song, variants, lyricists, translations });
});

  return routes;
}

/** The wired router mounted by the API server (Postgres-backed). */
export const songsRoutes = createSongsRoutes();
