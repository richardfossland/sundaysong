/**
 * Tests for the /upload page logic — client-side form validation — run OFFLINE
 * under `bun test` with no DOM, no API and no network, the same offline-first
 * discipline the API routes use.
 *
 * We exercise the pure module that the form (`UploadForm`) consumes. The
 * validation mirrors the server-side `SongUploadInputSchema`: required title +
 * language, the copyright-status enum, and the mandatory licence declaration.
 */

import { describe, expect, test } from "bun:test";

import { COPYRIGHT_OPTIONS, EMPTY_UPLOAD, validateUpload, type UploadFormState } from "@/lib/upload";

const form = (over: Partial<UploadFormState> = {}): UploadFormState => ({ ...EMPTY_UPLOAD, ...over });

// A minimal form that should pass: title + language + the licence checkbox.
const valid = (over: Partial<UploadFormState> = {}): UploadFormState =>
  form({ title: "Store Gud", language: "no", licenseDeclaration: true, ...over });

// ── Required fields ───────────────────────────────────────────────────────────

describe("validateUpload — required fields", () => {
  test("rejects an empty form — needs a title", () => {
    const r = validateUpload(form({ licenseDeclaration: true }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("title");
  });

  test("rejects a blank/short language code", () => {
    for (const bad of ["", " ", "x"]) {
      const r = validateUpload(valid({ language: bad }));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toContain("language");
    }
  });

  test("requires the licence declaration", () => {
    const r = validateUpload(valid({ licenseDeclaration: false }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("right to share");
  });

  test("accepts a minimal valid form and normalises the language", () => {
    const r = validateUpload(valid({ title: "  Store Gud  ", language: "NO" }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.input.title).toBe("Store Gud");
      expect(r.input.language).toBe("no");
      expect(r.input.license_declaration).toBe(true);
      expect(r.input.copyright_status).toBe("unknown");
    }
  });
});

// ── Copyright status enum ─────────────────────────────────────────────────────

describe("validateUpload — copyright status enum", () => {
  test("the option list is exactly the API enum", () => {
    expect(COPYRIGHT_OPTIONS.map((o) => o.value)).toEqual(["public_domain", "copyrighted", "unknown"]);
  });

  test("carries each valid status through", () => {
    for (const o of COPYRIGHT_OPTIONS) {
      const r = validateUpload(valid({ copyrightStatus: o.value }));
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.input.copyright_status).toBe(o.value);
    }
  });

  test("rejects a status outside the enum", () => {
    // The select can only produce enum values, but a tampered/out-of-range
    // value must still be rejected before we call the API.
    const r = validateUpload(valid({ copyrightStatus: "bogus" as UploadFormState["copyrightStatus"] }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("copyright");
  });
});

// ── Optional fields ───────────────────────────────────────────────────────────

describe("validateUpload — optional fields", () => {
  test("splits comma-separated themes + lyricists, trimming and de-duplicating", () => {
    const r = validateUpload(valid({ themes: " grace, creation , grace ", lyricists: "Carl Boberg, " }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.input.themes).toEqual(["grace", "creation"]);
      expect(r.input.lyricists).toEqual(["Carl Boberg"]);
    }
  });

  test("drops empty optionals rather than sending empty strings", () => {
    const r = validateUpload(valid());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.input.themes).toBeUndefined();
      expect(r.input.lyricists).toBeUndefined();
      expect(r.input.lyrics_excerpt).toBeUndefined();
      expect(r.input.lyrics_url).toBeUndefined();
      expect(r.input.year_first_published).toBeUndefined();
    }
  });

  test("parses a plausible year and rejects an implausible one", () => {
    const ok = validateUpload(valid({ yearFirstPublished: "1885" }));
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.input.year_first_published).toBe(1885);

    for (const bad of ["18.5", "-1", "9999", "abc"]) {
      const r = validateUpload(valid({ yearFirstPublished: bad }));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toContain("Year");
    }
  });

  test("requires http(s) URLs for lyrics + chord links", () => {
    const okUrl = validateUpload(valid({ lyricsUrl: "https://hymnary.org/text/abc", chordChartUrl: "http://example.com/chart" }));
    expect(okUrl.ok).toBe(true);
    if (okUrl.ok) {
      expect(okUrl.input.lyrics_url).toBe("https://hymnary.org/text/abc");
      expect(okUrl.input.chord_chart_url).toBe("http://example.com/chart");
    }

    const bad = validateUpload(valid({ lyricsUrl: "not a url" }));
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toContain("lyrics link");
  });

  test("carries a lyrics excerpt through, trimmed", () => {
    const r = validateUpload(valid({ lyricsExcerpt: "  O store Gud, når jeg…  " }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.input.lyrics_excerpt).toBe("O store Gud, når jeg…");
  });
});
