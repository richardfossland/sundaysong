/** Hand-written domain types. Keep in sync with `packages/db/migrations`. */

export type CopyrightStatus = "public_domain" | "copyrighted" | "unknown";

export interface Person {
  id: string;
  display_name: string;
  sort_name: string | null;
  birth_year: number | null;
  death_year: number | null;
  nationality: string | null;
  bio_short: string | null;
  external_ids: Record<string, string>;
}

export interface Song {
  id: string;
  canonical_title: string;
  original_language: string;
  year_first_published: number | null;
  copyright_status: CopyrightStatus;
  ccli_song_id: string | null;
  tono_work_id: string | null;
  tono_registered: boolean;
  hymnary_id: string | null;
  popularity_score: number;
  nordic_metadata: NordicMetadata;
  themes: string[];
  bible_refs: string[];
  created_at: string;
  updated_at: string;
}

export interface NordicMetadata {
  in_salmebok_2013?: boolean;
  salme_number?: number;
  in_n13_supplement?: boolean;
  norwegian_publisher?: string;
  /** Norwegian copyright status may differ from US/UK (life+70 rule). */
  copyright_status_no?: CopyrightStatus;
}

export interface SongVariant {
  id: string;
  song_id: string;
  source_id: string;
  source_external_id: string | null;
  title: string;
  language: string;
  key: string | null;
  bpm: number | null;
  meter: string | null;
  structure: SongSection[];
  lyrics_excerpt: string | null;
  lyrics_url: string | null;
  chord_chart_url: string | null;
  audio_demo_url: string | null;
  attribution_required: boolean;
  attribution_text: string | null;
  license_info: string | null;
  imported_at: string;
  last_verified_at: string | null;
}

export interface SongSection {
  label:
    | "verse_1" | "verse_2" | "verse_3" | "verse_4" | "verse_5" | "verse_6"
    | "chorus"  | "pre_chorus" | "bridge" | "tag" | "ending" | "intro"
    | "instrumental";
  lines: string[];
}

export type TranslationRelationship =
  | "official" | "unofficial" | "adaptation" | "paraphrase";

export interface Translation {
  id: string;
  source_song_id: string;
  target_song_id: string;
  relationship: TranslationRelationship;
  attribution: string | null;
  verified_by: "admin" | "community" | "ai_with_review";
  verified_at: string | null;
}

export interface UsageLogRow {
  id: string;
  church_id: string;
  song_id: string;
  variant_id: string | null;
  service_date: string;
  duration_displayed_sec: number | null;
  was_streamed: boolean;
  idempotency_key: string;
  recorded_at: string;
}

// ── Search / recommendation shapes ──────────────────────────────────────────

export interface SearchHit {
  song: Song;
  variants: SongVariant[];
  translations: Array<{ language: string; song_id: string; title: string }>;
  /** Why this result was returned. */
  match_reason: "text" | "semantic" | "hybrid";
  /** 0..1 confidence — for ranking display. */
  score: number;
  /** When semantic: a one-line "Because you searched for X" tag. */
  semantic_label?: string;
}

export interface RecommendInput {
  theme?: string;
  scripture?: string;
  description?: string;
  /** "next song after X" recommendations */
  after_song_id?: string;
  /** Energy/mood arc */
  arc?: "rising" | "reflective" | "celebration" | "lament";
  duration_min?: number;
  /** Limit recommendations to a church's library. */
  scope_to_church_id?: string;
  /** Force language */
  language?: string;
}

export interface RecommendOutput {
  picks: Array<{
    song: Song;
    reason: string;
    suggested_key?: string;
  }>;
  total_minutes_estimate: number;
  /** Free-form planner-facing explanation. */
  summary: string;
  /** True when an LLM re-ordered + re-explained the picks (Sunday Pro tier). */
  reranked: boolean;
}

// ── Liturgical season recommendation (use case C) ───────────────────────────

/**
 * The major seasons and feasts of the liturgical year as used by most Western
 * Christian traditions (including the Church of Norway / Den norske kirke).
 * Values are lowercase-hyphen slugs so they are URL-safe and schema-friendly.
 */
export type LiturgicalSeason =
  | "Advent"
  | "Christmas"
  | "Epiphany"
  | "Lent"
  | "HolyWeek"
  | "Easter"
  | "Pentecost"
  | "Trinity"
  | "AllSaints"
  | "OrdinaryTime";

export interface RecommendSeasonInput {
  season: LiturgicalSeason;
  /** Maximum number of songs to return (default 5, max 20). */
  limit?: number;
  /** Restrict to a specific language. */
  language?: string;
}

export interface RecommendSeasonPick {
  song_id: string;
  title: string;
  /** Semantic + thematic relevance score 0..1. */
  score: number;
  /** Why this song fits the season. */
  reason: string;
}

export interface RecommendSeasonOutput {
  season: LiturgicalSeason;
  picks: RecommendSeasonPick[];
  /** Human-readable summary of the season and the recommended set. */
  summary: string;
}

// ── Recommend-after (use case B: "songs that flow after X") ─────────────────

export interface RecommendAfterInput {
  /** The song we are flowing FROM — look up its key + BPM from variants. */
  songId: string;
  /** How many results to return (default 5, max 20). */
  limit?: number;
}

export interface RecommendAfterPick {
  song_id: string;
  title: string;
  /** Combined key-flow + BPM-proximity score 0..1. */
  score: number;
  reason: string;
  suggested_key?: string | null;
}

export interface RecommendAfterOutput {
  picks: RecommendAfterPick[];
  /** The from-song's key as used for scoring (null when not found). */
  from_key: string | null;
  /** True when key-flow scoring was applied. */
  key_flow: boolean;
}

// ── AI translation draft (Phase 4.2, Sunday Pro) ────────────────────────────

export interface TranslateInput {
  source_title: string;
  source_lyrics: string;
  source_language: string;
  target_language: string;
  style?: string;
  copyright_status?: CopyrightStatus;
  source_is_user_upload?: boolean;
}

export interface TranslationDraftResult {
  target_language: string;
  title: string;
  lyrics: string;
  singability: {
    confidence: number;
    warnings: string[];
    lines: Array<{ source: string; translated: string; source_syllables: number; translated_syllables: number }>;
  };
  warnings: string[];
  model: string;
  disclaimer: string;
}

// ── Licensing report shapes ─────────────────────────────────────────────────

export interface CcliReportRow {
  song_title: string;
  ccli_song_id: string;
  service_date: string;
  use_count: number;
}

export interface TonoReportRow {
  song_title: string;
  /** Norwegian rights-database id */
  tono_work_id: string;
  /** Dates the song was used in the period */
  dates: string[];
  streamed_count: number;
  in_room_count: number;
  /** For state-church-blanket users; informational only. */
  covered_by_blanket: boolean;
}

export interface LicensingReport {
  church_id: string;
  period_from: string;
  period_to: string;
  ccli_rows: CcliReportRow[];
  tono_rows: TonoReportRow[];
  /** Best-effort coverage summary. */
  coverage_warnings: string[];
}
