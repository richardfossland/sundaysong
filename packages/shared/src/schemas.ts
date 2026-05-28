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

export const LicensingReportInputSchema = z.object({
  church_id: z.string().uuid(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const CopyrightStatusSchema = z.enum(["public_domain", "copyrighted", "unknown"]);

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
