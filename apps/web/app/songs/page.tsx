import Link from "next/link";
import type { SearchHit } from "@sundaysong/sdk";
import { api } from "@/lib/client";
import {
  applyFacets,
  buildFacets,
  facetParam,
  type FacetGroup,
  type FacetSelection,
} from "@/lib/searchFacets";
import {
  activeFilterCount,
  buildSearchQuery,
  filtersFromQuery,
  filtersToParams,
  KEY_OPTIONS,
  type SearchFilterState,
} from "@/lib/searchFilters";

// The API is only reachable at request time (local in dev, Fly in prod), so we
// never want Next to try to render this at build — keep it dynamic.
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Search — SundaySong",
  description: "Search worship songs and hymns across languages — Nordic-first.",
};

type Mode = "text" | "meaning";

type Result =
  | { kind: "idle" }
  | { kind: "error"; message: string }
  | {
      kind: "ok";
      hits: SearchHit[];
      total: number;
      engine?: "meilisearch" | "postgres_fallback";
      semantic: boolean;
    };

async function runSearch(q: string, mode: Mode, filters: SearchFilterState): Promise<Result> {
  try {
    if (mode === "meaning") {
      // Semantic search only honours language server-side; the other musical
      // filters narrow text/Postgres search, so they don't apply here.
      const language = filtersToParams(filters).language;
      const res = await api.songs.semanticSearch({ query: q, ...(language ? { language } : {}) });
      return { kind: "ok", hits: res.hits, total: res.hits.length, semantic: true };
    }
    const res = await api.songs.search({ q, ...filtersToParams(filters) });
    return { kind: "ok", hits: res.hits, total: res.total, engine: res.engine, semantic: false };
  } catch (e) {
    return {
      kind: "error",
      message: e instanceof Error ? e.message : "Could not reach the SundaySong API.",
    };
  }
}

export default async function SongsSearchPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    mode?: string;
    theme?: string;
    lang?: string;
    copyright?: string;
    bpm_min?: string;
    bpm_max?: string;
    key?: string;
  }>;
}) {
  const sp = await searchParams;
  const { q, mode: modeParam, theme, lang, copyright } = sp;
  const query = (q ?? "").trim();
  const mode: Mode = modeParam === "meaning" ? "meaning" : "text";

  // Musical filter state from the URL (shared param names with the facet
  // sidebar: `lang`/`theme`). These pass through to the API call AND seed the
  // controls so the page is fully shareable/back-button-able.
  const filters = filtersFromQuery(sp);

  const result = query ? await runSearch(query, mode, filters) : ({ kind: "idle" } as Result);

  // Active facet selection from the URL — applied client-side to the fetched
  // page of results (no API change), and used to mark the active chips.
  const selection: FacetSelection = {
    ...(theme ? { theme } : {}),
    ...(lang ? { language: lang } : {}),
    ...(copyright ? { copyright } : {}),
  };

  return (
    <section className="section shell">
      <div className="section-head">
        <span className="no">⌕</span>
        <h2>Find a song</h2>
        <p className="sub">
          Cross-language, typo-tolerant search over the catalog — hymns, choruses, themes and
          scripture refs. Try a Norwegian title or its English translation.
        </p>
      </div>

      <form action="/songs" method="get" className="search-form">
        <input
          type="text"
          name="q"
          defaultValue={query}
          placeholder={mode === "meaning" ? "e.g. the song about chains falling off" : "e.g. Store Gud, Amazing Grace, Lord I lift…"}
          aria-label="Search songs"
          autoFocus
        />
        <select name="mode" defaultValue={mode} aria-label="Search mode">
          <option value="text">Text</option>
          <option value="meaning">By meaning</option>
        </select>
        <button className="btn" type="submit">Search</button>
      </form>

      <FilterControls filters={filters} mode={mode} query={query} />

      <p className="muted" style={{ fontSize: "0.85rem", marginTop: 8 }}>
        {mode === "meaning"
          ? "Semantic search — describe what the song is about, in any words. Only the language filter applies."
          : "Typo-tolerant text search across titles and variants."}
      </p>

      {result.kind === "error" && (
        <p className="err" role="alert" style={{ marginTop: 22 }}>{result.message}</p>
      )}

      {result.kind === "idle" && (
        <p className="muted" style={{ marginTop: 22 }}>
          Type a title, theme or scripture reference to begin.
        </p>
      )}

      {result.kind === "ok" && (
        <Results result={result} query={query} mode={mode} selection={selection} filters={filters} />
      )}
    </section>
  );
}

function Results({
  result,
  query,
  mode,
  selection,
  filters,
}: {
  result: Extract<Result, { kind: "ok" }>;
  query: string;
  mode: Mode;
  selection: FacetSelection;
  filters: SearchFilterState;
}) {
  // Facet counts are computed over the whole fetched page; the visible list is
  // the page narrowed by the active selection. Pagination/total are untouched —
  // this is pure client-side grouping of what the API already returned.
  const groups = buildFacets(result.hits);
  const visible = applyFacets(result.hits, selection);
  const activeCount = Object.values(selection).filter(Boolean).length;

  return (
    <div style={{ marginTop: 22 }}>
      <div className="result-meta">
        <span>
          {result.total} {result.total === 1 ? "result" : "results"} for{" "}
          <em className="serif-italic">{query}</em>
          {activeCount > 0 && (
            <>
              {" "}
              · {visible.length} shown after filtering
            </>
          )}
        </span>
        {result.semantic ? (
          <span className="engine-tag meilisearch">By meaning</span>
        ) : (
          <span className={`engine-tag ${result.engine}`}>
            {result.engine === "meilisearch" ? "Meilisearch" : "Postgres fallback"}
          </span>
        )}
      </div>

      {result.hits.length === 0 ? (
        <p className="muted" style={{ marginTop: 18 }}>
          Nothing matched. Try fewer words, or the other language.
        </p>
      ) : (
        <div className="search-layout">
          <FacetSidebar
            groups={groups}
            selection={selection}
            query={query}
            mode={mode}
            activeCount={activeCount}
            filters={filters}
          />
          <div className="search-results">
            {visible.length === 0 ? (
              <p className="muted" style={{ marginTop: 4 }}>
                No results match these filters. Clear a filter to see more.
              </p>
            ) : (
              <ul className="result-list">
                {visible.map((hit) => (
                  <SongRow key={hit.song.id} hit={hit} />
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Build the /songs URL for a given facet selection, always carrying the query
 * and mode so the server re-renders the same search with the new filters. The
 * musical filters (bpm/key, and any language/theme the controls set) are
 * preserved via `buildSearchQuery`; the facet selection's own lang/theme take
 * precedence (a clicked facet chip is the user's explicit choice), and the
 * copyright facet — which is a client-side narrowing, not an API param — is
 * appended on top.
 */
function facetHref(query: string, mode: Mode, selection: FacetSelection, filters: SearchFilterState): string {
  const merged: SearchFilterState = {
    ...filters,
    // A facet chip overrides the corresponding control value; clearing the chip
    // (selection.* undefined) falls back to the control's value so the two stay
    // consistent rather than fighting each other.
    language: selection.language ?? filters.language,
    theme: selection.theme ?? filters.theme,
  };
  const qs = buildSearchQuery({ q: query, mode, filters: merged });
  const params = new URLSearchParams(qs);
  if (selection.copyright) params.set("copyright", selection.copyright);
  return `/songs?${params.toString()}`;
}

function FacetSidebar({
  groups,
  selection,
  query,
  mode,
  activeCount,
  filters,
}: {
  groups: FacetGroup[];
  selection: FacetSelection;
  query: string;
  mode: Mode;
  activeCount: number;
  filters: SearchFilterState;
}) {
  return (
    <aside className="facets" aria-label="Filter results">
      <div className="facets-head">
        <span className="facets-title">Filter</span>
        {activeCount > 0 && (
          <Link className="facet-clear" href={facetHref(query, mode, {}, filters)}>
            Clear all
          </Link>
        )}
      </div>
      {groups.map((group) => {
        // Each dimension toggles independently: clicking the active value clears
        // it, clicking another replaces it — so a facet acts like a radio toggle.
        const key = facetParam(group.kind) === "lang" ? "language" : group.kind;
        return (
          <div key={group.kind} className="facet-group">
            <h4 className="facet-group-title">{group.title}</h4>
            <ul className="facet-list">
              {group.buckets.map((bucket) => {
                const isActive = selection[key as keyof FacetSelection] === bucket.value;
                const next: FacetSelection = {
                  ...selection,
                  [key]: isActive ? undefined : bucket.value,
                };
                return (
                  <li key={bucket.value}>
                    <Link
                      className="facet-chip"
                      href={facetHref(query, mode, next, filters)}
                      aria-pressed={isActive}
                    >
                      <span className="facet-label">{bucket.label}</span>
                      <span className="facet-count">{bucket.count}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </aside>
  );
}

function SongRow({ hit }: { hit: SearchHit }) {
  const { song, variants } = hit;
  const langs = Array.from(new Set([song.original_language, ...variants.map((v) => v.language)]));
  const status = copyrightView(song.copyright_status);

  // Surface the variant-level musical facts the filters search on: the distinct
  // keys, and the bpm range across the song's variants (de-duped, compact).
  const keys = Array.from(new Set(variants.map((v) => v.key).filter((k): k is string => !!k)));
  const bpms = variants.map((v) => v.bpm).filter((b): b is number => b != null);
  const bpmLabel = bpmRangeLabel(bpms);

  return (
    <li className="result-row">
      <Link href={`/songs/${encodeURIComponent(song.id)}`} className="result-link">
        <div className="result-main">
          <h3 className="result-title">{song.canonical_title}</h3>
          <div className="result-tags">
            {langs.map((l) => (
              <span key={l} className="lang-tag">{l.toUpperCase()}</span>
            ))}
            {song.year_first_published && <span className="year-tag">{song.year_first_published}</span>}
            {keys.length > 0 && (
              <span className="music-tag" title="Variant key(s)">
                {keys.length === 1 ? `Key ${keys[0]}` : `Keys ${keys.join(", ")}`}
              </span>
            )}
            {bpmLabel && (
              <span className="music-tag" title="Tempo across variants">{bpmLabel}</span>
            )}
            <span className={`pill ${status.cls}`} style={{ padding: "3px 9px", fontSize: "0.72rem" }}>
              <span className="dot" /> {status.label}
            </span>
          </div>
        </div>
        {song.themes.length > 0 && (
          <p className="result-themes">{song.themes.slice(0, 4).join(" · ")}</p>
        )}
      </Link>
    </li>
  );
}

/** Compact bpm label: a single value, or a "lo–hi bpm" range. Empty => "". */
function bpmRangeLabel(bpms: number[]): string {
  if (bpms.length === 0) return "";
  const lo = Math.min(...bpms);
  const hi = Math.max(...bpms);
  return lo === hi ? `${lo} bpm` : `${lo}–${hi} bpm`;
}

/**
 * The musical filter controls — a second GET form posting back to `/songs`,
 * carrying the current query + mode as hidden fields so submitting the filters
 * re-runs the same search. Server-rendered; the browser handles submission, so
 * no client JS is needed and the result is fully shareable via the URL.
 */
function FilterControls({
  filters,
  mode,
  query,
}: {
  filters: SearchFilterState;
  mode: Mode;
  query: string;
}) {
  const count = activeFilterCount(filters);
  return (
    <form action="/songs" method="get" className="filter-controls" aria-label="Filter search by music">
      <input type="hidden" name="q" value={query} />
      {mode === "meaning" && <input type="hidden" name="mode" value="meaning" />}

      <div className="filter-field">
        <label htmlFor="filter-lang">Language</label>
        <input
          id="filter-lang"
          type="text"
          name="lang"
          defaultValue={filters.language}
          placeholder="any (e.g. no, en)"
          maxLength={8}
        />
      </div>

      <div className="filter-field">
        <label htmlFor="filter-theme">Theme</label>
        <input
          id="filter-theme"
          type="text"
          name="theme"
          defaultValue={filters.theme}
          placeholder="any (e.g. grace)"
        />
      </div>

      <div className="filter-field">
        <label htmlFor="filter-key">Key</label>
        <select id="filter-key" name="key" defaultValue={filters.key}>
          <option value="">Any key</option>
          {KEY_OPTIONS.map((k) => (
            <option key={k} value={k}>{k}</option>
          ))}
        </select>
      </div>

      <div className="filter-field filter-bpm">
        <label htmlFor="filter-bpm-min">BPM</label>
        <div className="filter-bpm-range">
          <input
            id="filter-bpm-min"
            type="number"
            name="bpm_min"
            defaultValue={filters.bpmMin}
            placeholder="min"
            min={20}
            max={300}
            aria-label="Minimum BPM"
          />
          <span aria-hidden="true">–</span>
          <input
            type="number"
            name="bpm_max"
            defaultValue={filters.bpmMax}
            placeholder="max"
            min={20}
            max={300}
            aria-label="Maximum BPM"
          />
        </div>
      </div>

      <div className="filter-actions">
        <button className="btn btn-sm" type="submit">Apply filters</button>
        {count > 0 && (
          <Link className="facet-clear" href={`/songs?${query ? `q=${encodeURIComponent(query)}` : ""}${mode === "meaning" ? `${query ? "&" : ""}mode=meaning` : ""}`}>
            Clear ({count})
          </Link>
        )}
      </div>
    </form>
  );
}

function copyrightView(s: "public_domain" | "copyrighted" | "unknown"): { cls: string; label: string } {
  switch (s) {
    case "public_domain": return { cls: "ok", label: "Public domain" };
    case "copyrighted": return { cls: "bad", label: "Copyrighted" };
    case "unknown": return { cls: "warn", label: "Unknown" };
  }
}
