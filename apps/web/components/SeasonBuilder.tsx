"use client";

import { useState } from "react";
import Link from "next/link";
import type { LiturgicalSeason, RecommendSeasonOutput } from "@sundaysong/sdk";
import { api } from "@/lib/client";
import { buildSeasonInput, seasonLabel, SEASONS } from "@/lib/recommendSeason";

/**
 * "Songs that fit a liturgical season" — use case C. Pick a season (and an
 * optional language), call POST /v1/recommend/season, and render the curated
 * set. Semantic retrieval + thematic keyword scoring happen server-side.
 */
export function SeasonBuilder() {
  const [season, setSeason] = useState<LiturgicalSeason>("Advent");
  const [language, setLanguage] = useState("");
  const [result, setResult] = useState<RecommendSeasonOutput | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const out = await api.recommend.season(buildSeasonInput(season, language));
      setResult(out);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reach the SundaySong API.");
      setResult(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel panel-pad">
      <form className="stack" onSubmit={submit} aria-label="Season builder">
        <div className="field">
          <div className="field-label">Liturgical season</div>
          <div className="seg" role="group" aria-label="Liturgical season">
            {SEASONS.map((s) => (
              <button
                type="button"
                key={s.value}
                aria-pressed={season === s.value}
                onClick={() => setSeason(s.value)}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        <label className="field">
          <div className="field-label">Language (optional)</div>
          <input
            type="text"
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            placeholder="e.g. no, en, sv — leave blank for all"
          />
        </label>

        <div className="row" style={{ alignItems: "center" }}>
          <button className="btn btn-primary" type="submit" disabled={busy} aria-busy={busy}>
            {busy && <span className="spinner" aria-hidden />}
            {busy ? "Curating the season…" : `Suggest ${seasonLabel(season)} songs`}
          </button>
        </div>

        {error && <div className="err" role="alert">{error}</div>}
      </form>

      {result && (
        <div style={{ marginTop: 22 }}>
          <div className="result-meta">
            <span>
              {seasonLabel(result.season)} ·{" "}
              {result.picks.length} {result.picks.length === 1 ? "song" : "songs"}
            </span>
          </div>

          {result.summary && (
            <p className="muted" style={{ marginTop: 14, fontSize: "0.96rem" }}>
              {result.summary}
            </p>
          )}

          {result.picks.length === 0 ? (
            <p className="muted" style={{ marginTop: 18 }}>
              Nothing matched this season yet. Try another language, or a broader season.
            </p>
          ) : (
            <ol className="result-list" style={{ marginTop: 18 }}>
              {result.picks.map((pick, i) => (
                <li className="result-row" key={pick.song_id}>
                  <Link href={`/songs/${encodeURIComponent(pick.song_id)}`} className="result-link">
                    <div className="result-main">
                      <h3 className="result-title">
                        <span className="muted" style={{ fontFamily: "var(--font-mono)", fontSize: "0.8em" }}>
                          {i + 1}.
                        </span>{" "}
                        {pick.title}
                      </h3>
                    </div>
                    <p className="result-themes">{pick.reason}</p>
                  </Link>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}
