import { z } from "zod";

export const SongSearchQuerySchema = z.object({
  q: z.string().min(1).max(200),
  language: z.string().optional(),
  themes: z.array(z.string()).max(8).optional(),
  // These arrive as URL query strings, so coerce the numeric fields — `z.number()`
  // would reject the string form and make the endpoint impossible to page/filter.
  bpm_min: z.coerce.number().int().min(20).max(300).optional(),
  bpm_max: z.coerce.number().int().min(20).max(300).optional(),
  key: z.string().max(8).optional(),
  page: z.coerce.number().int().min(0).default(0),
  page_size: z.coerce.number().int().min(1).max(100).default(20),
});

export const SemanticSearchSchema = z.object({
  query: z.string().min(1).max(500),
  language: z.string().optional(),
  filters: z.object({
    themes: z.array(z.string()).optional(),
    public_domain_only: z.boolean().optional(),
  }).optional(),
});

/**
 * Current Sunday wire-contract version (mirrors `@sunday/contracts` SCHEMA_VERSION).
 * Every cross-app payload carries this in a `schema_version` field. Consumers
 * must ignore unknown fields (forward-compatible).
 */
export const SCHEMA_VERSION = 1 as const;

/** A `schema_version` field that defaults to the current version when omitted. */
const schemaVersionField = z.literal(SCHEMA_VERSION).default(SCHEMA_VERSION);

/**
 * Canonical cross-app usage event — the source of truth for CCLI + TONO
 * reporting. Emitted by SundayStage (or Plan) when a song is displayed during a
 * service and recorded by SundaySong's `/v1/usage/log` (deduped on
 * `idempotency_key`). `was_streamed` is the critical bit: streamed performances
 * feed a different royalty pool than in-room ones.
 *
 * This is the `@sunday/contracts` `UsageEvent` shape, vendored here until the
 * platform package is published. Once it ships, this block becomes a re-export
 * (`export { UsageEvent, buildUsageEvent, makeUsageIdempotencyKey, SCHEMA_VERSION } from "@sunday/contracts"`)
 * with no change to consumers. The Rust crate `sunday-contracts` mirrors the
 * same shape; `fixtures/usage_event.json` in sunday-platform is the round-trip
 * source of truth both languages conform to.
 */
export const UsageEvent = z.object({
  schema_version: schemaVersionField,
  church_id: z.string().uuid(),
  song_id: z.string().uuid(),
  variant_id: z.string().uuid().nullable(),
  /** ISO calendar date YYYY-MM-DD. */
  service_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  duration_displayed_sec: z.number().int().min(0).nullable(),
  was_streamed: z.boolean(),
  idempotency_key: z.string().min(8).max(120),
});
export type UsageEvent = z.infer<typeof UsageEvent>;

/**
 * Build a deterministic idempotency key for a usage event so a re-sent event
 * (network retry, app restart) never double-counts. Stable for a given service
 * item. Mirrors `@sunday/contracts` `makeUsageIdempotencyKey`.
 */
export function makeUsageIdempotencyKey(serviceId: string, serviceItemId: string): string {
  return `svc-${serviceId}:item-${serviceItemId}`;
}

/** Inputs for {@link buildUsageEvent} — the Stage→Song usage bridge. */
export interface BuildUsageEventInput {
  churchId: string;
  songId: string;
  variantId?: string | null;
  /** ISO calendar date YYYY-MM-DD. */
  serviceDate: string;
  wasStreamed: boolean;
  durationDisplayedSec?: number | null;
  /** The service this song was shown in — feeds the idempotency key. */
  serviceId: string;
  /** The running-order item — feeds the idempotency key. */
  serviceItemId: string;
}

/**
 * Build a validated {@link UsageEvent} from a service item, deriving the dedupe
 * key with {@link makeUsageIdempotencyKey} so a retried emit never
 * double-counts. The canonical way SundayStage/Plan report a played song to
 * SundaySong's `/v1/usage/log`. Mirrors `@sunday/contracts` `buildUsageEvent`.
 */
export function buildUsageEvent(input: BuildUsageEventInput): UsageEvent {
  return UsageEvent.parse({
    schema_version: SCHEMA_VERSION,
    church_id: input.churchId,
    song_id: input.songId,
    variant_id: input.variantId ?? null,
    service_date: input.serviceDate,
    duration_displayed_sec: input.durationDisplayedSec ?? null,
    was_streamed: input.wasStreamed,
    idempotency_key: makeUsageIdempotencyKey(input.serviceId, input.serviceItemId),
  });
}

/**
 * Back-compat alias for the canonical {@link UsageEvent}. The `/v1/usage/log`
 * route validates against this. Kept so the `@sundaysong/db` `logUsage` input
 * shape (which has no `schema_version` column) keeps compiling; new emitters
 * should build events with {@link buildUsageEvent}.
 */
export const UsageLogInputSchema = UsageEvent;

export const RecommendInputSchema = z.object({
  theme: z.string().optional(),
  scripture: z.string().optional(),
  description: z.string().max(2000).optional(),
  after_song_id: z.string().uuid().optional(),
  arc: z.enum(["rising", "reflective", "celebration", "lament"]).optional(),
  duration_min: z.number().int().min(1).max(180).optional(),
  language: z.string().optional(),
});

/**
 * Extended schema used only by the API route. Adds `_picks` (and `_after_key`)
 * for offline unit-testing: a fully-hydrated candidate pool is injected so the
 * route can run its heuristic ranking, key-flow and arc sequencing without a DB
 * or embedder. Each entry carries the full `song`, its retrieval
 * `semantic_score`, and the variant `key` / `bpm` the route would otherwise
 * resolve via `listVariantsForSong`. `_after_key` stands in for the key of the
 * song named by `after_song_id`. These fields are never set in production —
 * when `_picks` is absent the route takes the real DB + pgvector path.
 */
export const RecommendRouteSchema = RecommendInputSchema.extend({
  _picks: z
    .array(
      z.object({
        // The hydrated catalog song the route would return verbatim. Loosely
        // typed (passthrough) so a test fixture only has to fill the fields it
        // asserts on; the route hydrates the whole object back into `picks`.
        song: z.object({ id: z.string() }).passthrough(),
        semantic_score: z.number().min(0).max(1).default(0),
        key: z.string().nullable().optional(),
        bpm: z.number().nullable().optional(),
      }),
    )
    .optional(),
  /** Key of the `after_song_id` song (resolved from a variant in production). */
  _after_key: z.string().nullable().optional(),
});

export const LiturgicalSeasonSchema = z.enum([
  "Advent",
  "Christmas",
  "Epiphany",
  "Lent",
  "HolyWeek",
  "Easter",
  "Pentecost",
  "Trinity",
  "AllSaints",
  "OrdinaryTime",
]);

export const RecommendSeasonInputSchema = z.object({
  season: LiturgicalSeasonSchema,
  limit: z.number().int().min(1).max(20).default(5),
  language: z.string().optional(),
});

/**
 * Extended schema used only by the API route. Adds `_candidates` for offline
 * unit-testing (injected directly, bypassing the DB). The field is ignored in
 * production when the DB path is taken.
 */
export const RecommendSeasonRouteSchema = RecommendSeasonInputSchema.extend({
  _candidates: z
    .array(
      z.object({
        id: z.string(),
        title: z.string(),
        themes: z.array(z.string()).default([]),
        language: z.string().optional(),
        semantic_score: z.number().min(0).max(1).default(0),
      }),
    )
    .optional(),
});

export const RecommendAfterInputSchema = z.object({
  songId: z.string().min(1),
  limit: z.number().int().min(1).max(20).default(5),
});

/**
 * Extended schema used only by the API route. Adds `_candidates` for offline
 * unit-testing (injected directly, bypassing the DB). The field is ignored in
 * production when the DB path is taken.
 */
export const RecommendAfterRouteSchema = RecommendAfterInputSchema.extend({
  _candidates: z
    .array(
      z.object({
        id: z.string(),
        title: z.string(),
        key: z.string().nullable().optional(),
        bpm: z.number().nullable().optional(),
        popularity: z.number().optional(),
      }),
    )
    .optional(),
});

// ── Recommend-set (use case E: "build me a whole service") ──────────────────

/** Energy arc shapes the set composer can trace (mirrors @sundaysong/ai ArcShape). */
export const SetArcSchema = z.enum(["rising", "reflective", "celebration", "lament", "peak"]);

/** Constraints the set composer honours while sequencing. */
export const ComposeConstraintsSchema = z.object({
  /** Maximum BPM jump between consecutive songs (hard-penalised when exceeded). */
  max_bpm_jump: z.number().min(1).max(200).optional(),
  /** Target fraction of the set in a major key, 0..1 (omitted → no balancing). */
  major_ratio: z.number().min(0).max(1).optional(),
});

/**
 * POST /v1/recommend/set — compose a whole ordered service from a theme/scripture
 * seed, a target size or duration, an energy arc and the musical constraints.
 * Either `target_size` or `target_duration_min` may be given (size wins).
 */
export const RecommendSetInputSchema = z.object({
  theme: z.string().max(200).optional(),
  scripture: z.string().max(200).optional(),
  description: z.string().max(2000).optional(),
  language: z.string().optional(),
  arc: SetArcSchema.optional(),
  target_size: z.number().int().min(1).max(20).optional(),
  target_duration_min: z.number().int().min(1).max(240).optional(),
  constraints: ComposeConstraintsSchema.optional(),
});

/**
 * Extended schema used only by the API route. Adds `_candidates` for offline
 * unit-testing (a fully-hydrated pool injected directly, bypassing the DB +
 * embedder). Never set in production — when absent the route takes the real
 * retrieval path.
 */
export const RecommendSetRouteSchema = RecommendSetInputSchema.extend({
  _candidates: z
    .array(
      z.object({
        id: z.string(),
        canonical_title: z.string(),
        themes: z.array(z.string()).default([]),
        bible_refs: z.array(z.string()).default([]),
        popularity_score: z.number().default(0),
        language: z.string().default("en"),
        semantic_score: z.number().min(0).max(1).default(0),
        key: z.string().nullable().optional(),
        bpm: z.number().nullable().optional(),
        duration_sec: z.number().nullable().optional(),
      }),
    )
    .optional(),
});

export const LicensingReportInputSchema = z.object({
  church_id: z.string().uuid(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const CopyrightStatusSchema = z.enum(["public_domain", "copyrighted", "unknown"]);

/**
 * User upload (Phase 8.1). The contributor asserts they have the right to
 * share — we don't host content we have no license for, so the declaration is
 * mandatory. Moderation + per-user visibility land with Sunday-account auth.
 */
export const SongUploadInputSchema = z.object({
  title: z.string().min(1).max(300),
  language: z.string().min(2).max(8),
  year_first_published: z.number().int().min(0).max(3000).nullable().optional(),
  copyright_status: CopyrightStatusSchema.default("unknown"),
  lyricists: z.array(z.string().min(1).max(200)).max(16).optional(),
  themes: z.array(z.string().min(1).max(64)).max(16).optional(),
  bible_refs: z.array(z.string().min(1).max(64)).max(32).optional(),
  key: z.string().max(8).nullable().optional(),
  lyrics_excerpt: z.string().max(2000).nullable().optional(),
  lyrics_url: z.string().url().max(2000).nullable().optional(),
  chord_chart_url: z.string().url().max(2000).nullable().optional(),
  /** Required: "I have the right to share this." */
  license_declaration: z.literal(true),
});

/**
 * AI translation draft (Phase 4.2, Sunday Pro). The caller supplies the source
 * lyrics + their copyright context; the API enforces the same copyright gate
 * (PD or the user's own upload only). Lyrics are passed in rather than read
 * from the catalog because we don't store full lyrics we can't host.
 */
export const TranslateInputSchema = z.object({
  source_title: z.string().min(1).max(300),
  source_lyrics: z.string().min(1).max(20000),
  source_language: z.string().min(2).max(8),
  target_language: z.string().min(2).max(8),
  style: z.string().max(200).optional(),
  copyright_status: CopyrightStatusSchema.default("unknown"),
  /** The caller asserts these lyrics are their own upload (gives translate rights). */
  source_is_user_upload: z.boolean().default(false),
});

/** Transposition request. Provide chords[] or a chordpro blob, plus a target. */
export const TransposeInputSchema = z
  .object({
    chords: z.array(z.string().min(1).max(24)).max(1000).optional(),
    chordpro: z.string().max(50000).optional(),
    from_key: z.string().min(1).max(8),
    to_key: z.string().min(1).max(8).optional(),
    semitones: z.number().int().min(-11).max(11).optional(),
    dialect: z.enum(["international", "german"]).default("international"),
    nashville: z.boolean().default(false),
    capo: z.boolean().default(false),
  })
  .refine((d) => d.to_key !== undefined || d.semitones !== undefined, {
    message: "provide either to_key or semitones",
  })
  .refine((d) => (d.chords !== undefined) !== (d.chordpro !== undefined), {
    message: "provide exactly one of chords or chordpro",
  });

/** Church licensing profile — mirrors @sundaysong/licensing ChurchLicensingProfile. */
export const ChurchLicensingProfileSchema = z.object({
  church_id: z.string(),
  ccli_license_number: z.string().nullable().optional(),
  ccli_size_category: z.enum(["A", "B", "C", "D", "E", "F"]).nullable().optional(),
  ccli_streaming_addon: z.boolean(),
  tono_license_status: z.enum([
    "none",
    "state_church_blanket",
    "direct_agreement",
    "application_pending",
    "not_applicable",
  ]),
  tono_customer_id: z.string().nullable().optional(),
  tono_streaming_addon: z.boolean(),
  denomination: z.enum(["den_norske_kirke", "frikirke", "pinse", "baptist", "metodist", "other"]),
});

/** Song metadata the cross-language matcher reads (mirrors MatchSong). */
export const MatchSongSchema = z.object({
  id: z.string(),
  canonical_title: z.string().min(1).max(300),
  language: z.string().min(2).max(8),
  themes: z.array(z.string()).max(64).optional(),
  bible_refs: z.array(z.string()).max(64).optional(),
  year_first_published: z.number().int().min(0).max(3000).nullable().optional(),
  composer_ids: z.array(z.string()).max(32).optional(),
  ccli_song_id: z.string().nullable().optional(),
  tono_work_id: z.string().nullable().optional(),
});

export const MatchScoreInputSchema = z.object({
  a: MatchSongSchema,
  b: MatchSongSchema,
});

export const MatchCandidatesInputSchema = z.object({
  target: MatchSongSchema,
  pool: z.array(MatchSongSchema).max(500),
  min_confidence: z.number().min(0).max(1).optional(),
});

/** Per-song coverage request: enough song metadata to decide the pill. */
export const CoverageInputSchema = z.object({
  song: z.object({
    id: z.string(),
    canonical_title: z.string(),
    copyright_status: CopyrightStatusSchema,
    ccli_song_id: z.string().nullable().optional().default(null),
    tono_work_id: z.string().nullable().optional().default(null),
    tono_registered: z.boolean().default(false),
    nordic_metadata: z
      .object({ copyright_status_no: CopyrightStatusSchema.optional() })
      .passthrough()
      .default({}),
  }),
  profile: ChurchLicensingProfileSchema,
});
