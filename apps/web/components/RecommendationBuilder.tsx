"use client";

import { useState } from "react";
import type { RecommendOutput } from "@sundaysong/sdk";
import { api } from "@/lib/client";
import { ARCS, EMPTY_FORM, validateForm, type Arc, type RecommendFormState } from "@/lib/recommendations";
import { SetDisplay } from "./SetDisplay";

/**
 * The interactive "what should we sing?" builder. Collects an intent (theme,
 * scripture, free-text description and/or a song to follow), an optional energy
 * arc and a duration cap, validates client-side, then calls POST /v1/recommend
 * and renders the ranked set.
 */
export function RecommendationBuilder() {
  const [form, setForm] = useState<RecommendFormState>({
    ...EMPTY_FORM,
    theme: "grace",
    arc: "reflective",
  });
  const [result, setResult] = useState<RecommendOutput | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // The arc the *current* result was built with, for an accurate summary.
  const [resultArc, setResultArc] = useState<"" | Arc>("");

  const set = <K extends keyof RecommendFormState>(key: K, value: RecommendFormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const v = validateForm(form);
    if (!v.ok) {
      setError(v.error);
      setResult(null);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const out = await api.recommend(v.input);
      setResult(out);
      setResultArc(form.arc);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reach the SundaySong API.");
      setResult(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel panel-pad">
      <form className="stack" onSubmit={submit} aria-label="Recommendation builder">
        <div className="grid-2">
          <label className="field">
            <div className="field-label">Theme</div>
            <input
              type="text"
              value={form.theme}
              onChange={(e) => set("theme", e.target.value)}
              placeholder="e.g. grace, surrender, resurrection"
            />
          </label>
          <label className="field">
            <div className="field-label">Scripture</div>
            <input
              type="text"
              value={form.scripture}
              onChange={(e) => set("scripture", e.target.value)}
              placeholder="e.g. Psalm 23, John 3:16"
            />
          </label>
        </div>

        <label className="field">
          <div className="field-label">Describe the moment</div>
          <textarea
            value={form.description}
            onChange={(e) => set("description", e.target.value)}
            spellCheck={false}
            placeholder="e.g. opening set for Trinity Sunday, building toward communion"
          />
        </label>

        <div className="grid-2">
          <label className="field">
            <div className="field-label">After song (id, optional)</div>
            <input
              type="text"
              value={form.afterSongId}
              onChange={(e) => set("afterSongId", e.target.value)}
              placeholder="flow on from this song"
            />
          </label>
          <label className="field">
            <div className="field-label">Duration cap (min, optional)</div>
            <input
              type="number"
              min={1}
              inputMode="numeric"
              value={form.durationMin}
              onChange={(e) => set("durationMin", e.target.value)}
              placeholder="e.g. 20"
            />
          </label>
        </div>

        <div className="field">
          <div className="field-label">Energy arc</div>
          <div className="seg" role="group" aria-label="Energy arc">
            {ARCS.map((a) => (
              <button
                type="button"
                key={a.value}
                aria-pressed={form.arc === a.value}
                onClick={() => set("arc", form.arc === a.value ? "" : a.value)}
              >
                {a.label}
              </button>
            ))}
          </div>
        </div>

        <div className="row" style={{ alignItems: "center" }}>
          <button className="btn btn-primary" type="submit" disabled={busy} aria-busy={busy}>
            {busy && <span className="spinner" aria-hidden />}
            {busy ? "Building set…" : "Suggest a set"}
          </button>
        </div>

        {error && <div className="err" role="alert">{error}</div>}
      </form>

      {result && <SetDisplay out={result} arc={resultArc} />}
    </div>
  );
}
