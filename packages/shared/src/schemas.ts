import { z } from "zod";

export const SongSearchQuerySchema = z.object({
  q: z.string().min(1).max(200),
  language: z.string().optional(),
  themes: z.array(z.string()).max(8).optional(),
  bpm_min: z.number().int().min(20).max(300).optional(),
  bpm_max: z.number().int().min(20).max(300).optional(),
  key: z.string().max(8).optional(),
  page: z.number().int().min(0).default(0),
  page_size: z.number().int().min(1).max(100).default(20),
});

export const SemanticSearchSchema = z.object({
  query: z.string().min(1).max(500),
  language: z.string().optional(),
  filters: z.object({
    themes: z.array(z.string()).optional(),
    public_domain_only: z.boolean().optional(),
  }).optional(),
});

export const UsageLogInputSchema = z.object({
  church_id: z.string().uuid(),
  song_id: z.string().uuid(),
  variant_id: z.string().uuid().optional().nullable(),
  service_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  duration_displayed_sec: z.number().int().min(0).optional().nullable(),
  was_streamed: z.boolean().default(false),
  idempotency_key: z.string().min(8).max(120),
});

export const RecommendInputSchema = z.object({
  theme: z.string().optional(),
  scripture: z.string().optional(),
  description: z.string().max(2000).optional(),
  after_song_id: z.string().uuid().optional(),
  arc: z.enum(["rising", "reflective", "celebration", "lament"]).optional(),
  duration_min: z.number().int().min(1).max(180).optional(),
  scope_to_church_id: z.string().uuid().optional(),
  language: z.string().optional(),
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
