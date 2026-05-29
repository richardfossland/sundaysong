import Link from "next/link";
import type { SongDetail, SongVariant } from "@sunday/song-sdk";
import { SundaySongError } from "@sunday/song-sdk";
import { api } from "@/lib/client";

export const dynamic = "force-dynamic";

type Load =
  | { kind: "ok"; song: SongDetail }
  | { kind: "missing" }
  | { kind: "error"; message: string };

async function loadSong(id: string): Promise<Load> {
  try {
    const song = await api.songs.get(id);
    return { kind: "ok", song };
  } catch (e) {
    if (e instanceof SundaySongError && e.status === 404) return { kind: "missing" };
    return { kind: "error", message: e instanceof Error ? e.message : "Could not reach the API." };
  }
}

export default async function SongDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const load = await loadSong(id);

  if (load.kind !== "ok") {
    return (
      <section className="section shell">
        <BackLink />
        <h2 style={{ marginTop: 18 }}>
          {load.kind === "missing" ? "Song not found" : "Couldn't load that song"}
        </h2>
        <p className="muted" style={{ marginTop: 10 }}>
          {load.kind === "missing"
            ? "This song isn't in the catalog (or the id is wrong)."
            : `⚠ ${load.message}`}
        </p>
      </section>
    );
  }

  const { song } = load;
  const status = copyrightView(song.copyright_status);
  const statusNo = song.nordic_metadata.copyright_status_no
    ? copyrightView(song.nordic_metadata.copyright_status_no)
    : null;

  return (
    <section className="section shell">
      <BackLink />

      <div className="song-head">
        <p className="eyebrow">
          {song.original_language.toUpperCase()}
          {song.year_first_published ? ` · ${song.year_first_published}` : ""}
        </p>
        <h1 className="song-title">{song.canonical_title}</h1>
        {song.lyricists.length > 0 && (
          <p className="song-credit">
            Text by{" "}
            {song.lyricists.map((p, i) => (
              <span key={p.id}>
                {i > 0 ? ", " : ""}
                <span className="credit-name">{p.display_name}</span>
              </span>
            ))}
          </p>
        )}
      </div>

      {/* Identity + licensing rail — the TONO-first differentiator */}
      <div className="song-meta-grid">
        <Fact label="Copyright">
          <span className={`pill ${status.cls}`}><span className="dot" /> {status.label}</span>
          {statusNo && (
            <span className={`pill ${statusNo.cls}`} title="Norwegian copyright (life+70 may differ)">
              <span className="dot" /> NO · {statusNo.label}
            </span>
          )}
        </Fact>
        <Fact label="CCLI #">{song.ccli_song_id ?? <span className="muted">—</span>}</Fact>
        <Fact label="TONO work #">
          {song.tono_work_id ? (
            <>
              {song.tono_work_id}
              {song.tono_registered && <span className="reg-flag"> ✓ registered</span>}
            </>
          ) : (
            <span className="muted">{song.tono_registered ? "registered" : "—"}</span>
          )}
        </Fact>
        {song.nordic_metadata.salme_number != null && (
          <Fact label="Salmebok 2013">Nr. {song.nordic_metadata.salme_number}</Fact>
        )}
      </div>

      {song.translations.length > 0 && (
        <div className="translations-block">
          <div className="field-label">Also known as</div>
          <ul className="translation-list">
            {song.translations.map((t) => (
              <li key={t.song_id}>
                <Link href={`/songs/${encodeURIComponent(t.song_id)}`} className="translation-link">
                  <span className="lang-tag">{t.language.toUpperCase()}</span>
                  <span className="translation-title">{t.title}</span>
                  <span className="translation-rel">{t.relationship}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {(song.themes.length > 0 || song.bible_refs.length > 0) && (
        <div className="song-tax">
          {song.themes.length > 0 && (
            <div>
              <div className="field-label">Themes</div>
              <div className="tag-row">
                {song.themes.map((t) => <span key={t} className="lang-tag">{t}</span>)}
              </div>
            </div>
          )}
          {song.bible_refs.length > 0 && (
            <div>
              <div className="field-label">Scripture</div>
              <div className="tag-row">
                {song.bible_refs.map((r) => <span key={r} className="year-tag">{r}</span>)}
              </div>
            </div>
          )}
        </div>
      )}

      <hr className="rule-soft" style={{ margin: "34px 0 22px" }} />

      <h2 style={{ fontSize: "1.5rem", marginBottom: 16 }}>
        {song.variants.length} {song.variants.length === 1 ? "variant" : "variants"}
        <span className="muted" style={{ fontSize: "0.9rem", fontFamily: "var(--font-mono)", marginLeft: 12 }}>
          we catalog &amp; link — we don&apos;t host
        </span>
      </h2>

      {song.variants.length === 0 ? (
        <p className="muted">No variants linked yet.</p>
      ) : (
        <div className="variant-list">
          {song.variants.map((v) => <VariantCard key={v.id} v={v} />)}
        </div>
      )}
    </section>
  );
}

function VariantCard({ v }: { v: SongVariant }) {
  const facts = [
    v.key && `Key ${v.key}`,
    v.bpm && `${v.bpm} bpm`,
    v.meter,
  ].filter(Boolean) as string[];

  return (
    <div className="panel panel-pad variant-card">
      <div className="variant-top">
        <div>
          <h3 className="variant-title">{v.title}</h3>
          <span className="lang-tag">{v.language.toUpperCase()}</span>
        </div>
        {facts.length > 0 && <div className="variant-facts">{facts.join(" · ")}</div>}
      </div>

      {v.structure.length > 0 && (
        <div className="structure-row">
          {v.structure.map((s, i) => (
            <span key={i} className="section-chip">{prettySection(s.label)}</span>
          ))}
        </div>
      )}

      {v.lyrics_excerpt && (
        <blockquote className="excerpt ledger">{v.lyrics_excerpt}</blockquote>
      )}

      <div className="variant-links">
        {v.lyrics_url && <a className="ext-link" href={v.lyrics_url} target="_blank" rel="noreferrer">Lyrics ↗</a>}
        {v.chord_chart_url && <a className="ext-link" href={v.chord_chart_url} target="_blank" rel="noreferrer">Chords ↗</a>}
        {v.audio_demo_url && <a className="ext-link" href={v.audio_demo_url} target="_blank" rel="noreferrer">Audio ↗</a>}
      </div>

      {v.attribution_required && v.attribution_text && (
        <p className="attribution">{v.attribution_text}</p>
      )}
    </div>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="fact">
      <div className="field-label">{label}</div>
      <div className="fact-value">{children}</div>
    </div>
  );
}

function BackLink() {
  return <Link href="/songs" className="back-link">← Back to search</Link>;
}

function prettySection(label: string): string {
  return label.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function copyrightView(s: "public_domain" | "copyrighted" | "unknown"): { cls: string; label: string } {
  switch (s) {
    case "public_domain": return { cls: "ok", label: "Public domain" };
    case "copyrighted": return { cls: "bad", label: "Copyrighted" };
    case "unknown": return { cls: "warn", label: "Unknown" };
  }
}
