"use client";

import { useState } from "react";
import Link from "next/link";
import type { RecommendAfterOutput } from "@sundaysong/sdk";
import { api } from "@/lib/client";
import {
  EMPTY_AFTER_FORM,
  validateAfter,
  type AfterFormState,
} from "@/lib/recommendAfter";
import { explainFlow, flowScore, type FlowRelation } from "@/lib/keyFlowExplain";
import { CircleOfFifths } from "@/components/CircleOfFifths";

/** Accent colour per relationship category, drawn from the page tokens. */
const RELATION_COLOR: Record<FlowRelation, string> = {
  same: "var(--pine)",
  relative: "var(--pine-soft)",
  parallel: "var(--gold)",
  neighbour: "var(--gold)",
  near: "var(--ember)",
  distant: "var(--ember-deep)",
  unknown: "var(--ink-faint)",
};

/**
 * "Songs that flow after X", explained. Same engine as /recommendations/after
 * (POST /v1/recommend/after — pure music-theory key + BPM ranking), but this
 * surface leads with WHY each successor flows: same key, relative, parallel, a
 * fifth away, or a distant move, with a circle-of-fifths picture. All of the
 * relationship reasoning is the pure `explainFlow` helper.
 */
export function FlowBuilder() {
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

  const fromKey = result?.from_key ?? null;
  const successorKeys = result ? result.picks.map((p) => p.suggested_key ?? null) : [];

  return (
    <div className="panel panel-pad">
      <form className="stack" onSubmit={submit} aria-label="Key-flow builder">
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
          <button className="btn btn-primary" type="submit" disabled={busy} aria-busy={busy}>
            {busy && <span className="spinner" aria-hidden />}
            {busy ? "Reading the keys…" : "Show what flows next"}
          </button>
        </div>

        {error && <div className="err" role="alert">{error}</div>}
      </form>

      {result && (
        <div style={{ marginTop: 22 }}>
          <div className="result-meta">
            <span>
              {fromKey ? (
                <>
                  Flowing from <strong style={{ fontFamily: "var(--font-mono)" }}>{fromKey}</strong> ·{" "}
                  {result.picks.length} {result.picks.length === 1 ? "song" : "songs"} ·{" "}
                  {result.key_flow ? "key-flow + tempo" : "tempo only"}
                </>
              ) : (
                <>No key on the source song — ranked by tempo only.</>
              )}
            </span>
          </div>

          {result.key_flow && fromKey && result.picks.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <CircleOfFifths fromKey={fromKey} successorKeys={successorKeys} />
              <p
                className="muted"
                style={{ fontSize: "0.78rem", textAlign: "center", marginTop: 4 }}
              >
                <span style={{ color: "var(--ember)" }}>●</span> from key{"  "}
                <span style={{ color: "var(--gold)" }}>●</span> successors — closer on the ring flows
                smoother.
              </p>
            </div>
          )}

          {result.picks.length === 0 ? (
            <p className="muted" style={{ marginTop: 18 }}>
              Nothing flowed cleanly from that song. Try another id, or check the catalog has key
              data for it.
            </p>
          ) : (
            <ol className="result-list" style={{ marginTop: 18 }}>
              {result.picks.map((pick, i) => {
                const ex = explainFlow(fromKey, pick.suggested_key);
                const score = flowScore(fromKey, pick.suggested_key);
                const accent = RELATION_COLOR[ex.relation];
                return (
                  <li className="result-row" key={pick.song_id}>
                    <Link
                      href={`/songs/${encodeURIComponent(pick.song_id)}`}
                      className="result-link"
                    >
                      <div className="result-main">
                        <h3 className="result-title">
                          <span
                            className="muted"
                            style={{ fontFamily: "var(--font-mono)", fontSize: "0.8em" }}
                          >
                            {i + 1}.
                          </span>{" "}
                          {pick.title}
                        </h3>
                        <div className="result-tags">
                          <span
                            className="lang-tag"
                            style={{
                              fontFamily: "var(--font-mono)",
                              borderColor: accent,
                              color: accent,
                            }}
                            title={ex.detail}
                          >
                            {ex.badge} {ex.label}
                          </span>
                          {pick.suggested_key && (
                            <span className="lang-tag" style={{ fontFamily: "var(--font-mono)" }}>
                              key {pick.suggested_key}
                            </span>
                          )}
                          {score !== null && (
                            <span className="lang-tag" style={{ fontFamily: "var(--font-mono)" }}>
                              flow {Math.round(score * 100)}%
                            </span>
                          )}
                        </div>
                      </div>
                      <p className="result-themes">{ex.detail}</p>
                    </Link>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}
