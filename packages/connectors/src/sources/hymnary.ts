/**
 * Hymnary.org connector (Phase 2.2).
 *
 * Hymnary is the largest hymn metadata source in the world. Per the CLAUDE.md
 * positioning we *ingest their public-domain content and add the worship-specific
 * intelligence* — we never store copyrighted lyrics. So the connector's job is
 * almost entirely metadata: title, authors, language, scripture references,
 * first-publication year, and the cross-IDs (their `text_authority` id) we can
 * link back to.
 *
 * This file is split deliberately:
 *   - `normalizeHymnary` / the connector's `normalize()` are PURE — raw record
 *     in, canonical `NormalizedSong` out — and fully unit-tested on fixtures.
 *   - `discover()` / `fetch()` perform real HTTP and are NETWORK-UNVERIFIED:
 *     wired to compile, never run here (no outbound network in this env).
 *
 * The hard, worth-testing part is the public-domain decision. Hymnary exposes
 * authors with death years and a first-line/publication year; under the life+70
 * rule (and the simpler pre-1929 US public-domain cutoff) we can classify most
 * historic hymns with confidence and mark the rest `unknown` rather than guess.
 */

import type { Connector, DiscoverPage, NormalizedSong } from "../types";

/**
 * One author as Hymnary returns it on a text-authority record. Death year is
 * frequently present for historic hymnwriters and absent for living ones.
 */
export interface RawHymnaryAuthor {
  name: string;
  /** Role on the work; only lyric/text roles drive copyright + lyricist links. */
  role?: "author" | "translator" | "composer" | "arranger" | string;
  born?: number | null;
  died?: number | null;
}

/**
 * The subset of a Hymnary text-authority ("text") record we map. Real responses
 * carry far more; we pin only what the catalog needs so the parser is stable
 * against unrelated upstream additions.
 */
export interface RawHymnaryText {
  /** Hymnary's text-authority id, e.g. "amazing_grace_how_sweet_the_sound". */
  text_id: string;
  title: string;
  /** ISO-ish language code or a Hymnary language name we fold to a code. */
  language?: string | null;
  authors?: RawHymnaryAuthor[];
  /** First line, used as a fallback title and never as lyrics. */
  first_line?: string | null;
  /** Year the text first appeared in print, when Hymnary records it. */
  date?: number | string | null;
  /** Scripture references, in Hymnary's free-text form ("John 3:16"). */
  scripture_references?: string[];
  /** Topical tags. */
  topics?: string[];
  /** Hymnary's own copyright string, when present (e.g. "Public Domain"). */
  copyright?: string | null;
}

/** Past this year a US-first-published text is public domain by cutoff. */
export const PD_PUBLICATION_CUTOFF = 1929;
/** life + this many years is the Norwegian/EU public-domain rule. */
export const PD_LIFE_PLUS_YEARS = 70;
/** "This year" for the life+70 arithmetic; injectable so tests are stable. */
const DEFAULT_NOW_YEAR = 2026;

/** Map Hymnary's loose language values to our short codes; default English. */
function normalizeLanguage(raw: string | null | undefined): string {
  if (!raw) return "en";
  const v = raw.trim().toLowerCase();
  const map: Record<string, string> = {
    english: "en",
    en: "en",
    norwegian: "no",
    "norwegian bokmål": "no",
    bokmål: "no",
    no: "no",
    nynorsk: "nn",
    nn: "nn",
    swedish: "sv",
    sv: "sv",
    danish: "da",
    da: "da",
    german: "de",
    de: "de",
    latin: "la",
    la: "la",
  };
  return map[v] ?? (v.length === 2 ? v : "en");
}

/** Parse a Hymnary date that may be a number, a year string, or `"c. 1779"`. */
export function parseHymnaryYear(date: number | string | null | undefined): number | undefined {
  if (date == null) return undefined;
  if (typeof date === "number") return Number.isFinite(date) ? date : undefined;
  const m = date.match(/\b(\d{3,4})\b/);
  return m ? Number(m[1]) : undefined;
}

/** True for the author roles that carry the text's copyright (text, not music). */
function isTextRole(role: string | undefined): boolean {
  return role == null || role === "author" || role === "translator";
}

export interface CopyrightDecision {
  status: NormalizedSong["copyright_status"];
  /** Why we landed here — surfaced to admins, never silently guessed. */
  reason: string;
}

/**
 * Decide a text's copyright status from Hymnary metadata, conservatively.
 *
 * Order of evidence, strongest first:
 *  1. An explicit Hymnary "Public Domain" copyright string.
 *  2. life + 70: every *text* author has a death year and the latest is far
 *     enough back. A single living/unknown text author blocks this.
 *  3. Publication-year cutoff: printed before 1929 ⇒ public domain.
 *  4. An explicit non-PD copyright string ⇒ copyrighted.
 *  5. Otherwise `unknown` — we never guess a song into the public domain.
 */
export function decideCopyright(
  raw: RawHymnaryText,
  nowYear: number = DEFAULT_NOW_YEAR,
): CopyrightDecision {
  const copyright = raw.copyright?.trim().toLowerCase();
  if (copyright && /public\s*domain/.test(copyright)) {
    return { status: "public_domain", reason: "Hymnary marks this text as Public Domain." };
  }

  const textAuthors = (raw.authors ?? []).filter((a) => isTextRole(a.role));
  if (textAuthors.length > 0) {
    const deathYears = textAuthors.map((a) => a.died ?? null);
    if (deathYears.every((d) => d != null)) {
      const latest = Math.max(...(deathYears as number[]));
      if (nowYear - latest > PD_LIFE_PLUS_YEARS) {
        return {
          status: "public_domain",
          reason: `All text authors died by ${latest}; past life + ${PD_LIFE_PLUS_YEARS} years.`,
        };
      }
      return {
        status: "copyrighted",
        reason: `Latest text author death ${latest} is within life + ${PD_LIFE_PLUS_YEARS} years.`,
      };
    }
  }

  const year = parseHymnaryYear(raw.date);
  if (year != null && year < PD_PUBLICATION_CUTOFF) {
    return {
      status: "public_domain",
      reason: `First published ${year}, before the ${PD_PUBLICATION_CUTOFF} public-domain cutoff.`,
    };
  }

  if (copyright && copyright.length > 0) {
    return { status: "copyrighted", reason: `Hymnary copyright string: "${raw.copyright}".` };
  }

  return {
    status: "unknown",
    reason: "Not enough metadata to confirm public domain — flagged for review.",
  };
}

/**
 * Pure mapping: raw Hymnary text record → canonical `NormalizedSong`.
 *
 * Lyrics are deliberately NOT carried — we link out and store metadata only,
 * per the content-by-reference principle. The `nowYear` arg keeps the life+70
 * arithmetic deterministic under test.
 */
export function normalizeHymnary(
  raw: RawHymnaryText,
  nowYear: number = DEFAULT_NOW_YEAR,
): NormalizedSong {
  const title = (raw.title?.trim() || raw.first_line?.trim() || "").trim();
  if (!title) throw new Error(`hymnary text ${raw.text_id} has no title`); // permanent data error

  const language = normalizeLanguage(raw.language);
  const { status, reason } = decideCopyright(raw, nowYear);
  const year = parseHymnaryYear(raw.date);

  const lyricists = (raw.authors ?? [])
    .filter((a) => isTextRole(a.role) && a.name.trim())
    .map((a) => a.name.trim());

  const attributionParts = [
    lyricists.length ? `Text: ${lyricists.join(", ")}` : null,
    "Hymnary.org",
  ].filter(Boolean) as string[];

  return {
    source: "hymnary",
    source_external_id: raw.text_id,
    canonical_title: title,
    original_language: language,
    copyright_status: status,
    ...(year != null ? { year_first_published: year } : {}),
    hymnary_id: raw.text_id,
    themes: [...new Set((raw.topics ?? []).map((t) => t.trim()).filter(Boolean))],
    ...(lyricists.length ? { lyricists } : {}),
    variant: {
      title,
      language,
      // Link, never lyrics: Hymnary's text-authority page is the canonical URL.
      lyrics_url: `https://hymnary.org/text/${raw.text_id}`,
      attribution_text: `${attributionParts.join(" · ")} (${reason})`,
    },
  };
}

/** Hymnary's JSON API base. */
export const HYMNARY_API_BASE = "https://hymnary.org";

export interface HymnaryConnectorOptions {
  /** Override for tests / proxies. */
  apiBase?: string;
  /** Injected fetch so the pure surface stays testable; defaults to global. */
  fetchImpl?: typeof fetch;
  nowYear?: number;
}

/**
 * The live connector. `normalize()` is pure and tested; `discover()`/`fetch()`
 * are NETWORK-UNVERIFIED — wired to compile and shaped against Hymnary's API,
 * but never executed in this environment.
 */
export class HymnaryConnector implements Connector<RawHymnaryText> {
  readonly source = "hymnary";
  private readonly apiBase: string;
  private readonly fetchImpl: typeof fetch;
  private readonly nowYear: number;

  constructor(opts: HymnaryConnectorOptions = {}) {
    this.apiBase = opts.apiBase ?? HYMNARY_API_BASE;
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch;
    this.nowYear = opts.nowYear ?? DEFAULT_NOW_YEAR;
  }

  // NETWORK-UNVERIFIED: shaped against Hymnary's scripture/search JSON endpoint;
  // pagination cursor is the 1-based page index. Not exercised in this env.
  async discover(cursor?: string): Promise<DiscoverPage> {
    const page = cursor ? Number(cursor) : 1;
    const url = `${this.apiBase}/api/scripture?page=${page}`;
    const res = await this.fetchImpl(url);
    if (!res.ok) throw Object.assign(new Error(`hymnary discover ${res.status}`), { status: res.status });
    const body = (await res.json()) as { texts?: Array<{ text_id: string }>; has_more?: boolean };
    const externalIds = (body.texts ?? []).map((t) => t.text_id);
    return { externalIds, nextCursor: body.has_more ? String(page + 1) : undefined };
  }

  // NETWORK-UNVERIFIED: one text-authority record by id.
  async fetch(externalId: string): Promise<RawHymnaryText> {
    const url = `${this.apiBase}/api/text/${encodeURIComponent(externalId)}`;
    const res = await this.fetchImpl(url);
    if (!res.ok) throw Object.assign(new Error(`hymnary fetch ${res.status}`), { status: res.status });
    return (await res.json()) as RawHymnaryText;
  }

  normalize(raw: RawHymnaryText): NormalizedSong {
    return normalizeHymnary(raw, this.nowYear);
  }
}
