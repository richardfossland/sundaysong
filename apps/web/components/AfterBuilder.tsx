"use client";

import { useState } from "react";
import Link from "next/link";
import type { RecommendAfterOutput } from "@sundaysong/sdk";
import { api } from "@/lib/client";
import {
  afterKeyFlow,
  afterSummary,
  EMPTY_AFTER_FORM,
  validateAfter,
  type AfterFormState,
} from "@/lib/recommendAfter";

/**
 * "Songs that flow on from X" — use case B. Takes a song id, calls
 * POST /v1/recommend/after, and renders the ranked set with its key-flow.
 * Pure music-theory ranking server-side; this is just the form + renderer.
 */
export function AfterBuilder() {
  const [form, setForm] = useState<AfterFormState>({ ...EMPTY_AFTER_FORM });
  const [result, setResult] = useState<RecommendAfterOutput | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set = <K extends keyof AfterFormState>(key: K, value: AfterFormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const v = validateAfter(form);
    if (!v.ok) {
      setError(v.error);
      setResult(null);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const out = await api.recommend.after(v.input);
      setResult(out);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reach the SundaySong API.");
      setResult(null);
    } finally {
      setBusy(false);
    }
  }

  const keys = result ? afterKeyFlow(result) : [];

  return (
    <div className="panel panel-pad">
      <form className="stack" onSubmit={submit} aria-label="Flow-on builder">
        <div className="grid-2">
          <label className="field">
            <div className="field-label">Flow on from song (id)</div>
            <input
              type="text"
              value={form.songId}
              onChange={(e) => set("songId", e.target.value)}
              placeholder="the song you want to follow"
            />
          </label>
          <label className="field">
            <div className="field-label">How many (1–20, optional)</div>
            <input
              type="number"
              min={1}
              max={20}
              inputMode="numeric"
              value={form.limit}
              onChange={(e) => set("limit", e.target.value)}
              placeholder="e.g. 5"
            />
          </label>
        </div>

        <div className="row" style={{ alignItems: "center" }}>
          <button className="btn" type="submit" disabled={busy}>
            {busy ? "Finding the flow…" : "Suggest what flows next"}
          </button>
        </div>

        {error && <div className="err">⚠ {error}</div>}
      </form>

      {result && (
        <div style={{ marginTop: 22 }}>
          <div className="result-meta">
            <span>{afterSummary(result)}</span>
          </div>

          {keys.length > 0 && (
            <div className="row" style={{ marginTop: 12, gap: 10 }}>
              <span className="pill na" style={{ fontFamily: "var(--font-mono)" }}>
                <span className="dot" /> {keys.join(" → ")}
              </span>
            </div>
          )}

          {result.picks.length === 0 ? (
            <p className="muted" style={{ marginTop: 18 }}>
              Nothing flowed cleanly from that song. Try another id, or check the catalog has key
              data for it.
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
                      <div className="result-tags">
                        {pick.suggested_key && (
                          <span className="lang-tag" style={{ fontFamily: "var(--font-mono)" }}>
                            key {pick.suggested_key}
                          </span>
                        )}
                      </div>
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
