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

async function runSearch(q: string, mode: Mode): Promise<Result> {
  try {
    if (mode === "meaning") {
      const res = await api.songs.semanticSearch({ query: q });
      return { kind: "ok", hits: res.hits, total: res.hits.length, semantic: true };
    }
    const res = await api.songs.search({ q });
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
  searchParams: Promise<{ q?: string; mode?: string; theme?: string; lang?: string; copyright?: string }>;
}) {
  const { q, mode: modeParam, theme, lang, copyright } = await searchParams;
  const query = (q ?? "").trim();
  const mode: Mode = modeParam === "meaning" ? "meaning" : "text";
  const result = query ? await runSearch(query, mode) : ({ kind: "idle" } as Result);

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
      <p className="muted" style={{ fontSize: "0.85rem", marginTop: 8 }}>
        {mode === "meaning"
          ? "Semantic search — describe what the song is about, in any words."
          : "Typo-tolerant text search across titles and variants."}
      </p>

      {result.kind === "error" && (
        <p className="err" style={{ marginTop: 22 }}>⚠ {result.message}</p>
      )}

      {result.kind === "idle" && (
        <p className="muted" style={{ marginTop: 22 }}>
          Type a title, theme or scripture reference to begin.
        </p>
      )}

      {result.kind === "ok" && (
        <Results result={result} query={query} mode={mode} selection={selection} />
      )}
    </section>
  );
}

function Results({
  result,
  query,
  mode,
  selection,
}: {
  result: Extract<Result, { kind: "ok" }>;
  query: string;
  mode: Mode;
  selection: FacetSelection;
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
 * and mode so the server re-renders the same search with the new filters.
 */
function facetHref(query: string, mode: Mode, selection: FacetSelection): string {
  const params = new URLSearchParams({ q: query });
  if (mode === "meaning") params.set("mode", "meaning");
  if (selection.language) params.set("lang", selection.language);
  if (selection.theme) params.set("theme", selection.theme);
  if (selection.copyright) params.set("copyright", selection.copyright);
  return `/songs?${params.toString()}`;
}

function FacetSidebar({
  groups,
  selection,
  query,
  mode,
  activeCount,
}: {
  groups: FacetGroup[];
  selection: FacetSelection;
  query: string;
  mode: Mode;
  activeCount: number;
}) {
  return (
    <aside className="facets" aria-label="Filter results">
      <div className="facets-head">
        <span className="facets-title">Filter</span>
        {activeCount > 0 && (
          <Link className="facet-clear" href={facetHref(query, mode, {})}>
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
                      href={facetHref(query, mode, next)}
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

function copyrightView(s: "public_domain" | "copyrighted" | "unknown"): { cls: string; label: string } {
  switch (s) {
    case "public_domain": return { cls: "ok", label: "Public domain" };
    case "copyrighted": return { cls: "bad", label: "Copyrighted" };
    case "unknown": return { cls: "warn", label: "Unknown" };
  }
}
