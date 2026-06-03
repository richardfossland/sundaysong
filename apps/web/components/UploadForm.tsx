"use client";

import { useState } from "react";
import { api } from "@/lib/client";
import {
  COPYRIGHT_OPTIONS,
  EMPTY_UPLOAD,
  validateUpload,
  type UploadFormState,
} from "@/lib/upload";

/**
 * The public "contribute a song" form (Phase 8.1). Collects the catalog
 * metadata + the mandatory licence declaration, validates client-side, then
 * calls POST /v1/songs (via the SDK the rest of the app uses). On success it
 * shows a confirmation with the moderation next-steps — every contribution
 * enters the admin queue as `pending` before it goes live.
 *
 * We catalog + link, we don't host: lyrics/chord links are by reference, and
 * the excerpt is a short snippet only.
 */
export function UploadForm() {
  const [form, setForm] = useState<UploadFormState>(EMPTY_UPLOAD);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ song_id: string } | null>(null);

  const set = <K extends keyof UploadFormState>(key: K, value: UploadFormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const v = validateUpload(form);
    if (!v.ok) {
      setError(v.error);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await api.songs.upload(v.input);
      setDone({ song_id: res.song_id });
      setForm(EMPTY_UPLOAD);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reach the SundaySong API.");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="panel panel-pad">
        <h3 style={{ marginTop: 0 }}>Thank you — it's in the queue.</h3>
        <p className="sub">
          Your contribution has been received and is now <strong>pending review</strong>. A
          moderator checks new songs for accuracy and licensing before they go live in the catalog —
          usually within a few days.
        </p>
        <ul className="muted" style={{ lineHeight: 1.7 }}>
          <li>We verify the metadata and the copyright status you declared.</li>
          <li>Public-domain songs can be hosted; copyrighted ones are catalogued and linked.</li>
          <li>If we need a change, we'll note it on the entry.</li>
        </ul>
        <div className="row" style={{ marginTop: 18 }}>
          <button className="btn" type="button" onClick={() => setDone(null)}>
            Contribute another
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="panel panel-pad">
      <form className="stack" onSubmit={submit} aria-label="Song contribution form">
        <div className="grid-2">
          <label className="field">
            <div className="field-label">Title *</div>
            <input
              type="text"
              value={form.title}
              onChange={(e) => set("title", e.target.value)}
              placeholder="e.g. Store Gud, How Great Thou Art"
              required
            />
          </label>
          <label className="field">
            <div className="field-label">Language *</div>
            <input
              type="text"
              value={form.language}
              onChange={(e) => set("language", e.target.value)}
              placeholder="e.g. no, en, sv, da"
              required
            />
          </label>
        </div>

        <label className="field">
          <div className="field-label">Copyright status *</div>
          <select
            value={form.copyrightStatus}
            onChange={(e) => set("copyrightStatus", e.target.value as UploadFormState["copyrightStatus"])}
          >
            {COPYRIGHT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <p className="muted" style={{ fontSize: "0.8rem", marginTop: 6 }}>
            {COPYRIGHT_OPTIONS.find((o) => o.value === form.copyrightStatus)?.hint}
          </p>
        </label>

        <div className="grid-2">
          <label className="field">
            <div className="field-label">Lyricist(s)</div>
            <input
              type="text"
              value={form.lyricists}
              onChange={(e) => set("lyricists", e.target.value)}
              placeholder="comma-separated, e.g. Carl Boberg"
            />
          </label>
          <label className="field">
            <div className="field-label">Year first published</div>
            <input
              type="text"
              inputMode="numeric"
              value={form.yearFirstPublished}
              onChange={(e) => set("yearFirstPublished", e.target.value)}
              placeholder="e.g. 1885"
            />
          </label>
        </div>

        <label className="field">
          <div className="field-label">Themes</div>
          <input
            type="text"
            value={form.themes}
            onChange={(e) => set("themes", e.target.value)}
            placeholder="comma-separated, e.g. grace, creation, worship"
          />
        </label>

        <label className="field">
          <div className="field-label">Lyrics excerpt (a short snippet only)</div>
          <textarea
            value={form.lyricsExcerpt}
            onChange={(e) => set("lyricsExcerpt", e.target.value)}
            spellCheck={false}
            placeholder="First line or chorus — we don't host full lyrics we can't license."
          />
        </label>

        <div className="grid-2">
          <label className="field">
            <div className="field-label">Lyrics link</div>
            <input
              type="text"
              value={form.lyricsUrl}
              onChange={(e) => set("lyricsUrl", e.target.value)}
              placeholder="https://…"
            />
          </label>
          <label className="field">
            <div className="field-label">Chord-chart link</div>
            <input
              type="text"
              value={form.chordChartUrl}
              onChange={(e) => set("chordChartUrl", e.target.value)}
              placeholder="https://…"
            />
          </label>
        </div>

        <label className="field" style={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
          <input
            type="checkbox"
            checked={form.licenseDeclaration}
            onChange={(e) => set("licenseDeclaration", e.target.checked)}
            style={{ marginTop: 3 }}
            aria-label="I have the right to share this song"
          />
          <span className="muted" style={{ fontSize: "0.9rem" }}>
            I have the right to share this song, and the details above are accurate. I understand
            SundaySong catalogs and links — it doesn't host content it can't license.
          </span>
        </label>

        <div className="row" style={{ alignItems: "center" }}>
          <button className="btn" type="submit" disabled={busy}>
            {busy ? "Submitting…" : "Submit for review"}
          </button>
        </div>

        {error && <div className="err">⚠ {error}</div>}
      </form>
    </div>
  );
}
