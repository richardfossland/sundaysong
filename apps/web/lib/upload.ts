/**
 * Pure, framework-free logic for the /upload page (Phase 8.1).
 *
 * Kept out of the React component so it can be unit-tested under `bun test`
 * without jsdom or a DOM renderer — the same offline-first discipline the API
 * package uses for its route tests. The form (`UploadForm`) imports
 * `validateUpload` + the option lists; the tests exercise them directly.
 *
 * The validation mirrors the server-side `SongUploadInputSchema`
 * (`@sundaysong/shared`): a title, a language, a copyright status from the
 * enum, and the mandatory licence declaration — we don't accept a contribution
 * without the contributor asserting they have the right to share it.
 */

import type { SongUploadInput } from "@sundaysong/sdk";

export type CopyrightStatus = NonNullable<SongUploadInput["copyright_status"]>;

export const COPYRIGHT_OPTIONS: Array<{ value: CopyrightStatus; label: string; hint: string }> = [
  { value: "public_domain", label: "Public domain", hint: "Old enough that copyright has lapsed (we can host it)." },
  { value: "copyrighted", label: "Copyrighted", hint: "Under licence — we'll catalog + link, not host the content." },
  { value: "unknown", label: "Not sure", hint: "We'll check during moderation." },
];

const COPYRIGHT_VALUES = COPYRIGHT_OPTIONS.map((o) => o.value);

/** Raw, all-string form state — what the controlled inputs hold. */
export interface UploadFormState {
  title: string;
  language: string;
  copyrightStatus: CopyrightStatus;
  themes: string;
  lyricists: string;
  yearFirstPublished: string;
  lyricsExcerpt: string;
  lyricsUrl: string;
  chordChartUrl: string;
  licenseDeclaration: boolean;
}

export const EMPTY_UPLOAD: UploadFormState = {
  title: "",
  language: "no",
  copyrightStatus: "unknown",
  themes: "",
  lyricists: "",
  yearFirstPublished: "",
  lyricsExcerpt: "",
  lyricsUrl: "",
  chordChartUrl: "",
  licenseDeclaration: false,
};

/** Split a comma-separated field into trimmed, non-empty, de-duplicated tags. */
function tagList(raw: string): string[] {
  const seen = new Set<string>();
  for (const part of raw.split(",")) {
    const t = part.trim();
    if (t) seen.add(t);
  }
  return [...seen];
}

const looksLikeUrl = (v: string): boolean => /^https?:\/\/\S+$/i.test(v);

/**
 * Validate the form and, on success, project it onto a `SongUploadInput`.
 *
 * Rules (the required-field + enum contract the server enforces too):
 *  - `title` is required.
 *  - `language` is required (a 2–8 char code, e.g. "no", "en", "sv").
 *  - `copyright_status` must be one of the enum values.
 *  - `license_declaration` MUST be checked — we never accept a contribution
 *    without the right-to-share assertion.
 *  - Year, when given, must be a plausible 0–3000 integer.
 *  - Lyrics / chord-chart links, when given, must be http(s) URLs.
 * Empty optional fields are dropped so we never send `""` to the API.
 */
export function validateUpload(
  form: UploadFormState,
): { ok: true; input: SongUploadInput } | { ok: false; error: string } {
  const title = form.title.trim();
  if (!title) return { ok: false, error: "A title is required." };

  const language = form.language.trim().toLowerCase();
  if (language.length < 2 || language.length > 8) {
    return { ok: false, error: "Enter a language code, e.g. no, en, sv, da." };
  }

  if (!COPYRIGHT_VALUES.includes(form.copyrightStatus)) {
    return { ok: false, error: "Choose a copyright status." };
  }

  if (form.licenseDeclaration !== true) {
    return { ok: false, error: "Please confirm you have the right to share this song." };
  }

  const input: SongUploadInput = {
    title,
    language,
    copyright_status: form.copyrightStatus,
    license_declaration: true,
  };

  const yearRaw = form.yearFirstPublished.trim();
  if (yearRaw) {
    const year = Number(yearRaw);
    if (!Number.isInteger(year) || year < 0 || year > 3000) {
      return { ok: false, error: "Year first published should be a number like 1779." };
    }
    input.year_first_published = year;
  }

  const themes = tagList(form.themes);
  if (themes.length) input.themes = themes;

  const lyricists = tagList(form.lyricists);
  if (lyricists.length) input.lyricists = lyricists;

  const excerpt = form.lyricsExcerpt.trim();
  if (excerpt) input.lyrics_excerpt = excerpt;

  const lyricsUrl = form.lyricsUrl.trim();
  if (lyricsUrl) {
    if (!looksLikeUrl(lyricsUrl)) return { ok: false, error: "The lyrics link must be a full http(s) URL." };
    input.lyrics_url = lyricsUrl;
  }

  const chordUrl = form.chordChartUrl.trim();
  if (chordUrl) {
    if (!looksLikeUrl(chordUrl)) return { ok: false, error: "The chord-chart link must be a full http(s) URL." };
    input.chord_chart_url = chordUrl;
  }

  return { ok: true, input };
}
