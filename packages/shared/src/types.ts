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

// ── Recommend-set (use case E: "build me a whole service") ──────────────────

/** Energy arc shapes the set composer can trace. */
export type SetArc = "rising" | "reflective" | "celebration" | "lament" | "peak";

export interface ComposeConstraints {
  /** Maximum BPM jump between consecutive songs (hard-penalised when exceeded). */
  max_bpm_jump?: number;
  /** Target fraction of the set in a major key, 0..1. */
  major_ratio?: number;
}

export interface RecommendSetInput {
  theme?: string;
  scripture?: string;
  description?: string;
  language?: string;
  arc?: SetArc;
  /** Target number of songs (takes precedence over duration). */
  target_size?: number;
  /** Target total running time in minutes. */
  target_duration_min?: number;
  constraints?: ComposeConstraints;
}

/** One song placed in the composed service, with its full reasoning. */
export interface RecommendSetSlot {
  position: number;
  song: Song;
  /** Combined objective contribution of placing this song here. */
  score: number;
  reason: string;
  suggested_key: string | null;
  bpm: number | null;
  /** Estimated 0..1 energy of this song. */
  energy: number;
  /** Target arc energy for this slot (−1 when no arc was requested). */
  target_energy: number;
  /** Whether this slot breaks the BPM-jump cap. */
  tempo_violation: boolean;
}

export interface RecommendSetOutput {
  slots: RecommendSetSlot[];
  total_minutes_estimate: number;
  /** Fraction of the placed set in a major key (null when no keys are known). */
  major_ratio: number | null;
  /** The energy / key / tempo path through the set. */
  trajectory: {
    energy: number[];
    target_energy: number[];
    keys: (string | null)[];
    bpm: (number | null)[];
  };
  /** Number of consecutive pairs that exceed the BPM cap. */
  tempo_violations: number;
  summary: string;
  /** The arc the set was sequenced along, echoed back (undefined when none). */
  arc?: SetArc;
}

// ── Sermon-to-Setlist ───────────────────────────────────────────────────────

export interface RecommendFromSermonInput {
  manuscript?: string;
  scripture_refs?: string[];
  title?: string;
  language?: string;
  duration_min?: number;
  /** When present, each pick gets a CCLI/TONO coverage pill. */
  profile?: ChurchLicensingProfileLike;
}

/** Minimal church licensing profile (mirrors @sundaysong/licensing). */
export interface ChurchLicensingProfileLike {
  church_id: string;
  ccli_license_number?: string | null;
  ccli_size_category?: "A" | "B" | "C" | "D" | "E" | "F" | null;
  ccli_streaming_addon: boolean;
  tono_license_status: "none" | "state_church_blanket" | "direct_agreement" | "application_pending" | "not_applicable";
  tono_customer_id?: string | null;
  tono_streaming_addon: boolean;
  denomination: "den_norske_kirke" | "frikirke" | "pinse" | "baptist" | "metodist" | "other";
}

/** Per-song coverage status (mirrors @sundaysong/licensing SongCoverage). */
export interface SongCoverageLike {
  song_id: string;
  ccli_status: "covered" | "not_covered" | "unknown" | "not_required" | "foreign_reciprocal";
  tono_status: "covered" | "not_covered" | "unknown" | "not_required" | "foreign_reciprocal";
  gray_areas: string[];
}

export interface RecommendFromSermonOutput {
  /** What the extractor pulled out of the sermon (the basis for the picks). */
  extract: {
    themes: string[];
    scripture: string[];
    arc: "rising" | "reflective" | "celebration" | "lament" | null;
    keywords: string[];
    summary: string;
    /** "llm" when an Anthropic key was configured, "heuristic" on the keyless path. */
    source: "llm" | "heuristic";
  };
  picks: Array<{
    song: Song;
    reason: string;
    suggested_key?: string;
    /** CCLI/TONO coverage pill — present only when a `profile` was supplied. */
    coverage?: SongCoverageLike;
  }>;
  total_minutes_estimate: number;
  summary: string;
  /** True when an LLM re-ordered + re-explained the picks (Sunday Pro tier). */
  reranked: boolean;
  /** The arc the set was sequenced along, echoed back (undefined when none). */
  arc?: "rising" | "reflective" | "celebration" | "lament";
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
