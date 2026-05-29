import Link from "next/link";
import type { SearchHit } from "@sunday/song-sdk";
import { api } from "@/lib/client";

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
  searchParams: Promise<{ q?: string; mode?: string }>;
}) {
  const { q, mode: modeParam } = await searchParams;
  const query = (q ?? "").trim();
  const mode: Mode = modeParam === "meaning" ? "meaning" : "text";
  const result = query ? await runSearch(query, mode) : ({ kind: "idle" } as Result);

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
        <div style={{ marginTop: 22 }}>
          <div className="result-meta">
            <span>
              {result.total} {result.total === 1 ? "result" : "results"} for{" "}
              <em className="serif-italic">{query}</em>
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
            <ul className="result-list">
              {result.hits.map((hit) => (
                <SongRow key={hit.song.id} hit={hit} />
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
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
