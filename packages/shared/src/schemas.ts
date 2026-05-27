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
