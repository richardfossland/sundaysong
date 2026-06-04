"use client";

import { useState } from "react";
import Link from "next/link";
import type { RecommendSetOutput } from "@sundaysong/sdk";
import { api } from "@/lib/client";
import {
  SET_ARCS,
  EMPTY_SET_FORM,
  validateSetForm,
  formatSetDuration,
  setKeyFlow,
  setSummaryLine,
  energyLabel,
  type SetArc,
  type SetFormState,
} from "@/lib/recommendSet";

/**
 * The "build me a whole service" composer (use case E). Collects an intent, a
 * target size or duration, an energy arc and the musical constraints, then
 * calls POST /v1/recommend/set and renders the composed, ordered set with its
 * per-slot rationale and energy / key / tempo trajectory.
 *
 * Reuses the catalog result-row + pill styling so it reads like the rest of the
 * recommendation surfaces.
 */
export function SetBuilder() {
  const [form, setForm] = useState<SetFormState>({ ...EMPTY_SET_FORM, theme: "grace" });
  const [result, setResult] = useState<RecommendSetOutput | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set = <K extends keyof SetFormState>(key: K, value: SetFormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const v = validateSetForm(form);
    if (!v.ok) {
      setError(v.error);
      setResult(null);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const out = await api.recommend.compose(v.input);
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
      <form className="stack" onSubmit={submit} aria-label="Set composer">
        <div className="grid-2">
          <label className="field">
            <div className="field-label">Theme</div>
            <input
              type="text"
              value={form.theme}
              onChange={(e) => set("theme", e.target.value)}
              placeholder="e.g. grace, resurrection, communion"
            />
          </label>
          <label className="field">
            <div className="field-label">Scripture</div>
            <input
              type="text"
              value={form.scripture}
              onChange={(e) => set("scripture", e.target.value)}
              placeholder="e.g. Psalm 23, Romans 8"
            />
          </label>
        </div>

        <label className="field">
          <div className="field-label">Describe the service</div>
          <textarea
            value={form.description}
            onChange={(e) => set("description", e.target.value)}
            spellCheck={false}
            placeholder="e.g. Sunday-morning worship building toward communion"
          />
        </label>

        <div className="field">
          <div className="field-label">Energy arc</div>
          <div className="seg" role="group" aria-label="Energy arc">
            {SET_ARCS.map((a) => (
              <button
                type="button"
                key={a.value}
                aria-pressed={form.arc === a.value}
                onClick={() => set("arc", form.arc === a.value ? "" : (a.value as SetArc))}
              >
                {a.label}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <div className="field-label">Size by</div>
          <div className="seg" role="group" aria-label="Size mode">
            <button type="button" aria-pressed={form.sizeMode === "size"} onClick={() => set("sizeMode", "size")}>
              Song count
            </button>
            <button type="button" aria-pressed={form.sizeMode === "duration"} onClick={() => set("sizeMode", "duration")}>
              Duration
            </button>
          </div>
        </div>

        <div className="grid-2">
          {form.sizeMode === "size" ? (
            <label className="field">
              <div className="field-label">Number of songs (1–20)</div>
              <input
                type="number"
                min={1}
                max={20}
                inputMode="numeric"
                value={form.targetSize}
                onChange={(e) => set("targetSize", e.target.value)}
                placeholder="e.g. 5"
              />
            </label>
          ) : (
            <label className="field">
              <div className="field-label">Target duration (min)</div>
              <input
                type="number"
                min={1}
                inputMode="numeric"
                value={form.targetDurationMin}
                onChange={(e) => set("targetDurationMin", e.target.value)}
                placeholder="e.g. 20"
              />
            </label>
          )}
          <label className="field">
            <div className="field-label">Max tempo jump (BPM, optional)</div>
            <input
              type="number"
              min={1}
              inputMode="numeric"
              value={form.maxBpmJump}
              onChange={(e) => set("maxBpmJump", e.target.value)}
              placeholder="e.g. 20 — cap the BPM step between songs"
            />
          </label>
        </div>

        <label className="field">
          <div className="field-label">Major-key share (%, optional)</div>
          <input
            type="number"
            min={0}
            max={100}
            inputMode="numeric"
            value={form.majorPct}
            onChange={(e) => set("majorPct", e.target.value)}
            placeholder="e.g. 60 — balance major vs minor keys"
          />
        </label>

        <div className="row" style={{ alignItems: "center" }}>
          <button className="btn" type="submit" disabled={busy}>
            {busy ? "Composing the service…" : "Compose a service"}
          </button>
        </div>

        {error && <div className="err">⚠ {error}</div>}
      </form>

      {result && <ComposedSet out={result} />}
    </div>
  );
}

/** Renders a composed set: headline, trajectory pills, then each ordered slot. */
function ComposedSet({ out }: { out: RecommendSetOutput }) {
  const keys = setKeyFlow(out);
  const hasArc = out.trajectory.target_energy.length > 0;

  return (
    <div style={{ marginTop: 22 }}>
      <div className="result-meta">
        <span>{setSummaryLine(out)}</span>
        {out.tempo_violations > 0 && (
          <span className="engine-tag">
            {out.tempo_violations} tempo step{out.tempo_violations === 1 ? "" : "s"} over cap
          </span>
        )}
      </div>

      <div className="row" style={{ marginTop: 12, gap: 10, flexWrap: "wrap" }}>
        <span className="pill na">
          <span className="dot" /> {formatSetDuration(out.total_minutes_estimate)}
        </span>
        {keys.length > 0 && (
          <span className="pill na" style={{ fontFamily: "var(--font-mono)" }}>
            <span className="dot" /> {keys.join(" → ")}
          </span>
        )}
        {hasArc && (
          <span className="pill na" style={{ fontFamily: "var(--font-mono)" }}>
            <span className="dot" /> {out.trajectory.energy.map((e) => energyLabel(e)).join(" → ")}
          </span>
        )}
      </div>

      {out.summary && (
        <p className="muted" style={{ marginTop: 14, fontSize: "0.96rem" }}>
          {out.summary}
        </p>
      )}

      {out.slots.length === 0 ? (
        <p className="muted" style={{ marginTop: 18 }}>
          Nothing matched closely enough to compose a set. Try a broader theme or drop the language
          filter.
        </p>
      ) : (
        <ol className="result-list" style={{ marginTop: 18 }}>
          {out.slots.map((slot) => (
            <li className="result-row" key={`${slot.position}-${slot.song.id}`}>
              <Link href={`/songs/${encodeURIComponent(slot.song.id)}`} className="result-link">
                <div className="result-main">
                  <h3 className="result-title">
                    <span className="muted" style={{ fontFamily: "var(--font-mono)", fontSize: "0.8em" }}>
                      {slot.position + 1}.
                    </span>{" "}
                    {slot.song.canonical_title}
                  </h3>
                  <div className="result-tags">
                    <span className="lang-tag">{slot.song.original_language.toUpperCase()}</span>
                    {slot.suggested_key && (
                      <span className="lang-tag" style={{ fontFamily: "var(--font-mono)" }}>
                        key {slot.suggested_key}
                      </span>
                    )}
                    {slot.bpm != null && (
                      <span className="year-tag" style={{ fontFamily: "var(--font-mono)" }}>
                        {slot.bpm} BPM
                      </span>
                    )}
                    {slot.tempo_violation && <span className="engine-tag">tempo jump</span>}
                  </div>
                </div>
                <p className="result-themes">{slot.reason}</p>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
