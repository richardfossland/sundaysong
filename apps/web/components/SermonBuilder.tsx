"use client";

import { useState } from "react";
import Link from "next/link";
import { Clock, KeyRound, ScrollText } from "lucide-react";
import type { RecommendFromSermonOutput } from "@sundaysong/sdk";
import { api } from "@/lib/client";
import {
  EMPTY_SERMON_FORM,
  validateSermonForm,
  coveragePill,
  type SermonFormState,
} from "@/lib/recommendSermon";
import { formatDuration } from "@/lib/recommendations";

/**
 * Sermon-to-Setlist builder. Paste next Sunday's sermon (and/or its scripture
 * refs) and get a full catalog-grounded set whose themes, scripture and energy
 * arc serve the message. Extraction uses Anthropic when a key is configured and
 * degrades to a keyword heuristic otherwise — either way a set comes back.
 * Calls the SDK's `songs.recommendFromSermon` (POST /v1/recommend/from-sermon).
 */
export function SermonBuilder() {
  const [form, setForm] = useState<SermonFormState>(EMPTY_SERMON_FORM);
  const [result, setResult] = useState<RecommendFromSermonOutput | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set = <K extends keyof SermonFormState>(key: K, value: SermonFormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const v = validateSermonForm(form);
    if (!v.ok) {
      setError(v.error);
      setResult(null);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const out = await api.songs.recommendFromSermon(v.input);
      setResult(out);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fikk ikke kontakt med SundaySong-API-et.");
      setResult(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel panel-pad">
      <form className="stack" onSubmit={submit} aria-label="Sermon-to-setlist builder">
        <label className="field">
          <div className="field-label">Tittel (valgfritt)</div>
          <input
            type="text"
            value={form.title}
            onChange={(e) => set("title", e.target.value)}
            placeholder="f.eks. Den bortkomne sønn"
          />
        </label>

        <label className="field">
          <div className="field-label">Prekenmanus / notater</div>
          <textarea
            value={form.manuscript}
            onChange={(e) => set("manuscript", e.target.value)}
            spellCheck={false}
            rows={10}
            placeholder="Lim inn manuset eller notatene — temaer, tekster og energibue trekkes ut automatisk."
          />
        </label>

        <div className="grid-2">
          <label className="field">
            <div className="field-label">Bibeltekster (én per linje, valgfritt)</div>
            <textarea
              value={form.scriptureRefs}
              onChange={(e) => set("scriptureRefs", e.target.value)}
              spellCheck={false}
              rows={3}
              placeholder={"Lukas 15:11-32\nSalme 103"}
            />
          </label>
          <label className="field">
            <div className="field-label">Varighet (min, valgfritt)</div>
            <input
              type="number"
              min={1}
              inputMode="numeric"
              value={form.durationMin}
              onChange={(e) => set("durationMin", e.target.value)}
              placeholder="f.eks. 20"
            />
          </label>
        </div>

        <div className="row" style={{ alignItems: "center" }}>
          <button className="btn" type="submit" disabled={busy}>
            {busy ? "Bygger settet…" : "Foreslå lovsanger til prekenen"}
          </button>
        </div>

        {error && <div className="err">⚠ {error}</div>}
      </form>

      {result && <SermonResult out={result} />}
    </div>
  );
}

/** Renders the extracted sermon basis, then the ordered, reasoned set. */
function SermonResult({ out }: { out: RecommendFromSermonOutput }) {
  const { extract } = out;
  return (
    <div style={{ marginTop: 22 }}>
      <div className="result-meta">
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <ScrollText size={15} aria-hidden strokeWidth={1.75} /> Utdrag fra prekenen
        </span>
        {extract.source === "llm" ? (
          <span className="engine-tag meilisearch">AI-utdrag</span>
        ) : (
          <span className="engine-tag">Stikkord-utdrag (ingen AI-nøkkel)</span>
        )}
        {out.reranked && <span className="engine-tag meilisearch">AI re-rangert</span>}
      </div>

      {extract.summary && (
        <p className="muted" style={{ marginTop: 10, fontSize: "0.96rem" }}>
          {extract.summary}
        </p>
      )}

      <div className="row" style={{ marginTop: 12, gap: 8, flexWrap: "wrap" }}>
        {extract.themes.map((t) => (
          <span className="lang-tag" key={`theme-${t}`}>
            {t}
          </span>
        ))}
        {extract.scripture.map((s) => (
          <span className="year-tag" key={`ref-${s}`}>
            {s}
          </span>
        ))}
      </div>

      <div className="row" style={{ marginTop: 12, gap: 10 }}>
        <span className="pill na">
          <Clock size={14} aria-hidden strokeWidth={1.75} /> {formatDuration(out.total_minutes_estimate)}
        </span>
      </div>

      {out.summary && (
        <p className="muted" style={{ marginTop: 14, fontSize: "0.96rem" }}>
          {out.summary}
        </p>
      )}

      {out.picks.length === 0 ? (
        <p className="muted" style={{ marginTop: 18 }}>
          Ingenting passet godt nok ennå. Prøv et bredere tema eller flere tekster.
        </p>
      ) : (
        <ol className="result-list" style={{ marginTop: 18 }}>
          {out.picks.map((pick, i) => {
            const pill = pick.coverage ? coveragePill(pick.coverage) : null;
            const pillClass = pill?.tone === "ok" ? "ok" : pill?.tone === "no" ? "bad" : "warn";
            return (
              <li className="result-row" key={pick.song.id}>
                <Link href={`/songs/${encodeURIComponent(pick.song.id)}`} className="result-link">
                  <div className="result-main">
                    <h3 className="result-title">
                      <span className="muted" style={{ fontFamily: "var(--font-mono)", fontSize: "0.8em" }}>
                        {i + 1}.
                      </span>{" "}
                      {pick.song.canonical_title}
                    </h3>
                    <div className="result-tags">
                      <span className="lang-tag">{pick.song.original_language.toUpperCase()}</span>
                      {pick.suggested_key && (
                        <span
                          className="lang-tag"
                          style={{ fontFamily: "var(--font-mono)", display: "inline-flex", alignItems: "center", gap: 4 }}
                        >
                          <KeyRound size={11} aria-hidden strokeWidth={2} /> {pick.suggested_key}
                        </span>
                      )}
                      {pill && (
                        <span className={`pill ${pillClass}`}>
                          <span className="dot" /> {pill.text}
                        </span>
                      )}
                    </div>
                  </div>
                  <p className="result-themes">{pick.reason}</p>
                </Link>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
