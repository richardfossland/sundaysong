"use client";

import { useEffect, useState } from "react";
import type { TransposeResult } from "@sundaysong/sdk";
import { api } from "@/lib/client";

const MAJOR = ["C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
const MINOR = ["Am", "Bbm", "Bm", "Cm", "C#m", "Dm", "Ebm", "Em", "Fm", "F#m", "Gm", "G#m"];

export function Transposer() {
  const [raw, setRaw] = useState("G  D  Em7  Cadd9  G/B  D/F#");
  const [fromKey, setFromKey] = useState("G");
  const [toKey, setToKey] = useState("A");
  const [dialect, setDialect] = useState<"international" | "german">("international");
  const [nashville, setNashville] = useState(true);
  const [capo, setCapo] = useState(true);

  const [result, setResult] = useState<TransposeResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const chords = raw.split(/\s+/).map((c) => c.trim()).filter(Boolean);
    if (chords.length === 0) { setResult(null); return; }

    const handle = setTimeout(async () => {
      setBusy(true);
      setError(null);
      try {
        const res = await api.transpose({ chords, from_key: fromKey, to_key: toKey, dialect, nashville, capo });
        setResult(res);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not reach the SundaySong API.");
        setResult(null);
      } finally {
        setBusy(false);
      }
    }, 220);
    return () => clearTimeout(handle);
  }, [raw, fromKey, toKey, dialect, nashville, capo]);

  return (
    <div className="panel panel-pad ledger">
      <div className="stack">
        <div className="row">
          <label className="field" style={{ flex: "1 1 130px" }}>
            <div className="field-label">From key</div>
            <select value={fromKey} onChange={(e) => setFromKey(e.target.value)}>
              <KeyOptions />
            </select>
          </label>
          <label className="field" style={{ flex: "1 1 130px" }}>
            <div className="field-label">To key</div>
            <select value={toKey} onChange={(e) => setToKey(e.target.value)}>
              <KeyOptions />
            </select>
          </label>
          <div className="field">
            <div className="field-label">Notation</div>
            <div className="seg" role="group" aria-label="Notation dialect">
              <button aria-pressed={dialect === "international"} onClick={() => setDialect("international")}>Intl</button>
              <button aria-pressed={dialect === "german"} onClick={() => setDialect("german")}>Nordic (H/B)</button>
            </div>
          </div>
        </div>

        <label className="field">
          <div className="field-label">Chords</div>
          <textarea value={raw} onChange={(e) => setRaw(e.target.value)} spellCheck={false} />
        </label>

        <div className="row" style={{ alignItems: "center" }}>
          <button className="chip" aria-pressed={nashville} onClick={() => setNashville((v) => !v)}>Nashville #</button>
          <button className="chip" aria-pressed={capo} onClick={() => setCapo((v) => !v)}>Capo tips</button>
          <span className="muted" style={{ marginLeft: "auto", fontFamily: "var(--font-mono)", fontSize: "0.74rem" }}>
            {busy ? "transposing…" : result ? `${result.from_key} → ${result.to_key}  (${result.semitones >= 0 ? "+" : ""}${result.semitones} st)` : ""}
          </span>
        </div>

        {error && <div className="err">⚠ {error} — is the API running on {process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001"}?</div>}

        {result?.chords && (
          <div>
            <hr className="rule-soft" />
            <div className="chart" style={{ marginTop: 18 }}>
              {result.chords.map((ch, i) => (
                <div className="chord" key={`${ch}-${i}`} style={{ animationDelay: `${i * 28}ms` }}>
                  {ch}
                  {result.nashville?.[i] && <span className="nash">{result.nashville[i]}</span>}
                </div>
              ))}
            </div>
            {result.capo && result.capo.length > 0 && (
              <div className="capo-row">
                {result.capo.slice(0, 4).map((c) => (
                  <span className="capo" key={c.capo}>capo <b>{c.capo}</b> · play <b>{c.playAs}</b></span>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function KeyOptions() {
  return (
    <>
      <optgroup label="Major">
        {MAJOR.map((k) => <option key={k} value={k}>{k}</option>)}
      </optgroup>
      <optgroup label="Minor">
        {MINOR.map((k) => <option key={k} value={k}>{k}</option>)}
      </optgroup>
    </>
  );
}
