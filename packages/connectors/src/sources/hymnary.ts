/**
 * Hymnary.org connector (Phase 2.2).
 *
 * Hymnary is the largest hymn metadata source in the world. Per the CLAUDE.md
 * positioning we *ingest their public-domain content and add the worship-specific
 * intelligence* — we never store copyrighted lyrics. So the connector's job is
 * almost entirely metadata: title, authors, language, scripture references,
 * first-publication year, and the text-authority id we can link back to.
 *
 * This file is split deliberately:
 *   - `normalizeHymnary` / the connector's `normalize()` are PURE — raw record
 *     in, canonical `NormalizedSong` out — and fully unit-tested on fixtures.
 *   - `parseScriptureItem` is PURE — it maps Hymnary's *real* API JSON (with its
 *     human-readable, space-separated keys) onto our internal `RawHymnaryText`.
 *   - `discover()` / `fetch()` perform real HTTP and are NETWORK-UNVERIFIED:
 *     wired to compile and shaped against Hymnary's *documented* API, but never
 *     executed here (no outbound network in this env).
 *
 * The hard, worth-testing part is the public-domain decision. Hymnary exposes
 * authors with death years and a first-publication year; under the life+70 rule
 * (and the simpler pre-1929 US public-domain cutoff) we can classify most
 * historic hymns with confidence and mark the rest `unknown` rather than guess.
 *
 * ── API contract (verified 2026-06 against hymnary.org/api/scripture docs) ──
 * Hymnary's only public JSON endpoint is the *scripture* search:
 *   GET /api/scripture?reference=Psalm+136
 *   GET /api/scripture?book=Psalms&fromChapter=136            (range params)
 * It returns up to 100 hymns associated with that passage. The payload is an
 * object keyed by an index string, each value an object with HUMAN-READABLE,
 * space-separated keys: "title", "date", "meter", "placeOfOrigin",
 * "originalLanguage", "text link", "number of hymnals", "scripture references",
 * plus person roles ("composer", "arranger", and authors). There is no
 * documented per-id `/api/text/:id` JSON endpoint and no page cursor — the
 * metadata we need is inline in the scripture response. So discovery walks a
 * list of scripture references, caching each inline record; `fetch()` returns
 * the cached record. The text-authority id is parsed out of the "text link"
 * URL (`https://hymnary.org/text/<text_id>`). See docs/NEEDS-RICHARD.md.
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
 * The subset of a Hymnary text-authority record we map, in our *internal*
 * normalized shape. `parseScriptureItem` produces this from the live API's
 * human-readable JSON; fixtures and `normalizeHymnary` consume it. Real
 * responses carry far more; we pin only what the catalog needs so the mapper is
 * stable against unrelated upstream additions.
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

/**
 * The text-authority id Hymnary embeds in a "text link" URL, e.g.
 * `https://hymnary.org/text/amazing_grace_how_sweet_the_sound` → the trailing
 * slug. Returns `undefined` for a link that is not a text-authority URL.
 */
export function parseTextIdFromLink(link: string | null | undefined): string | undefined {
  if (!link) return undefined;
  const m = link.match(/\/text\/([^/?#]+)/);
  return m ? m[1] : undefined;
}

/** The roles Hymnary attaches person names to, in its real scripture payload. */
const PERSON_ROLE_KEYS = ["author", "translator", "composer", "arranger"] as const;

/** Coerce Hymnary's person value (string, or {name,...}) into our author shape. */
function coercePerson(role: string, value: unknown): RawHymnaryAuthor | undefined {
  if (typeof value === "string") {
    const name = value.trim();
    return name ? { name, role } : undefined;
  }
  if (value && typeof value === "object") {
    const o = value as { name?: unknown; born?: unknown; died?: unknown };
    const name = typeof o.name === "string" ? o.name.trim() : "";
    if (!name) return undefined;
    return {
      name,
      role,
      born: typeof o.born === "number" ? o.born : null,
      died: typeof o.died === "number" ? o.died : null,
    };
  }
  return undefined;
}

/** Normalize a scalar-or-array field to a trimmed string array. */
function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((v) => String(v).trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split(/[;,]/)
      .map((v) => v.trim())
      .filter(Boolean);
  }
  return [];
}

/**
 * PURE: map ONE item from Hymnary's live `/api/scripture` JSON onto our internal
 * `RawHymnaryText`. The live keys are human-readable and space-separated
 * ("text link", "number of hymnals", "scripture references", "originalLanguage")
 * and people arrive under role keys ("author"/"composer"/...) as a string or an
 * array of strings. Returns `undefined` when the item has no usable text id —
 * Hymnary occasionally returns instance rows with no text-authority link, which
 * we skip rather than mint a bogus id.
 */
export function parseScriptureItem(item: Record<string, unknown>): RawHymnaryText | undefined {
  const link =
    (typeof item["text link"] === "string" && (item["text link"] as string)) ||
    (typeof item["textLink"] === "string" && (item["textLink"] as string)) ||
    undefined;
  const text_id = parseTextIdFromLink(link);
  if (!text_id) return undefined;

  const authors: RawHymnaryAuthor[] = [];
  for (const role of PERSON_ROLE_KEYS) {
    const raw = item[role];
    const values = Array.isArray(raw) ? raw : raw != null ? [raw] : [];
    for (const v of values) {
      const person = coercePerson(role, v);
      if (person) authors.push(person);
    }
  }

  const language =
    (typeof item["originalLanguage"] === "string" && (item["originalLanguage"] as string)) ||
    (typeof item["original language"] === "string" && (item["original language"] as string)) ||
    null;

  const dateRaw = item["date"];
  const date =
    typeof dateRaw === "number" || typeof dateRaw === "string" ? dateRaw : null;

  return {
    text_id,
    title: typeof item["title"] === "string" ? (item["title"] as string) : "",
    language,
    authors,
    first_line: typeof item["first_line"] === "string" ? (item["first_line"] as string) : null,
    date,
    scripture_references: toStringArray(item["scripture references"] ?? item["scriptureReferences"]),
    topics: toStringArray(item["topics"] ?? item["topic"]),
    copyright:
      typeof item["copyright"] === "string" ? (item["copyright"] as string) : null,
  };
}

/**
 * PURE: parse a whole `/api/scripture` body into our internal records. Hymnary
 * returns either a JSON array of items or an object keyed by an index string
 * whose values are the items; we accept both. Items without a text id are
 * skipped (see `parseScriptureItem`).
 */
export function parseScriptureResponse(body: unknown): RawHymnaryText[] {
  const items: unknown[] = Array.isArray(body)
    ? body
    : body && typeof body === "object"
      ? Object.values(body as Record<string, unknown>)
      : [];
  const out: RawHymnaryText[] = [];
  for (const it of items) {
    if (it && typeof it === "object") {
      const parsed = parseScriptureItem(it as Record<string, unknown>);
      if (parsed) out.push(parsed);
    }
  }
  return out;
}

/**
 * The scripture references discovery walks. Hymnary has no flat catalog cursor;
 * the documented way to enumerate texts is by scripture passage (up to 100
 * hymns each). A modest, well-known-passage default gives a broad first sweep
 * of historic hymnody; override for a fuller crawl. Each reference is one
 * discover() page.
 */
export const DEFAULT_DISCOVERY_REFERENCES: readonly string[] = [
  "Psalm 23",
  "Psalm 46",
  "Psalm 100",
  "Psalm 103",
  "Psalm 121",
  "Psalm 136",
  "Isaiah 40",
  "Matthew 6",
  "Luke 2",
  "John 3:16",
  "Romans 8",
  "1 Corinthians 13",
  "Philippians 2",
  "Revelation 5",
];

export interface HymnaryConnectorOptions {
  /** Override for tests / proxies. */
  apiBase?: string;
  /** Injected fetch so the pure surface stays testable; defaults to global. */
  fetchImpl?: typeof fetch;
  nowYear?: number;
  /**
   * Scripture references to enumerate, one per discover() page. Defaults to
   * `DEFAULT_DISCOVERY_REFERENCES`; pass a fuller list for a deeper crawl.
   */
  references?: readonly string[];
}

/**
 * The live connector. `normalize()` + the scripture parsers are pure and tested;
 * `discover()`/`fetch()` are NETWORK-UNVERIFIED — wired to compile and shaped
 * against Hymnary's *documented* scripture API, but never executed in this
 * environment.
 *
 * Discovery walks `references` (one passage per page). Because Hymnary returns
 * the full metadata inline and exposes no per-id JSON endpoint, discover()
 * caches each parsed record and `fetch()` serves it from that cache — so a
 * sync hits the network once per reference, not once per hymn.
 */
export class HymnaryConnector implements Connector<RawHymnaryText> {
  readonly source = "hymnary";
  private readonly apiBase: string;
  private readonly fetchImpl: typeof fetch;
  private readonly nowYear: number;
  private readonly references: readonly string[];
  /** Records harvested during discover(), keyed by text id, served by fetch(). */
  private readonly cache = new Map<string, RawHymnaryText>();

  constructor(opts: HymnaryConnectorOptions = {}) {
    this.apiBase = opts.apiBase ?? HYMNARY_API_BASE;
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch;
    this.nowYear = opts.nowYear ?? DEFAULT_NOW_YEAR;
    this.references = opts.references ?? DEFAULT_DISCOVERY_REFERENCES;
  }

  // NETWORK-UNVERIFIED: shaped against the documented /api/scripture endpoint.
  // The cursor is the 1-based index into `references`; each page is one passage.
  async discover(cursor?: string): Promise<DiscoverPage> {
    const idx = cursor ? Number(cursor) : 0;
    const reference = this.references[idx];
    if (reference == null) return { externalIds: [] };

    const url = `${this.apiBase}/api/scripture?reference=${encodeURIComponent(reference)}`;
    const res = await this.fetchImpl(url);
    if (!res.ok) {
      throw Object.assign(new Error(`hymnary discover ${res.status}`), { status: res.status });
    }
    const records = parseScriptureResponse(await res.json());
    for (const rec of records) this.cache.set(rec.text_id, rec);

    const nextIdx = idx + 1;
    return {
      externalIds: records.map((r) => r.text_id),
      nextCursor: nextIdx < this.references.length ? String(nextIdx) : undefined,
    };
  }

  // Served from the discover() cache: Hymnary's scripture payload already
  // carries the full metadata, and there is no documented per-id JSON endpoint.
  // A miss is a permanent error (the orchestrator dead-letters it) since
  // re-fetching cannot help.
  async fetch(externalId: string): Promise<RawHymnaryText> {
    const cached = this.cache.get(externalId);
    if (!cached) {
      throw Object.assign(new Error(`hymnary fetch: ${externalId} not in discover cache`), {
        status: 404,
      });
    }
    return cached;
  }

  normalize(raw: RawHymnaryText): NormalizedSong {
    return normalizeHymnary(raw, this.nowYear);
  }
}
