/**
 * AI translation drafts (Phase 4.2, Feature 2 — Sunday Pro).
 *
 * Translating a worship song is not translating prose: the result has to be
 * *singable* — line count and per-line syllable count must track the original
 * or the melody no longer fits. The plan's etterord warning #4 is explicit: a
 * bad AI hymn translation gets quoted in church and embarrasses us. So the
 * value here is the **guards**, all pure and testable offline:
 *   - a copyright gate (we only draft from PD or user-uploaded lyrics — never
 *     re-translate CCLI-licensed content we don't host),
 *   - a content-quality gate (garbage in ⇒ refuse, don't draft),
 *   - a singability assessment that scores the draft against the original's
 *     line/syllable shape and surfaces warnings + a confidence the UI must show.
 * The single network call (the LLM) sits behind the same `LlmClient` seam as
 * the re-ranker; unlike re-ranking there is no heuristic fallback (you cannot
 * machine-translate hymnody without a model), so a missing client is an error,
 * not a silent degrade.
 */

import type { LlmClient } from "./llm";
import type { CopyrightStatus } from "@sundaysong/shared";

/** Vowel groups per language, for the syllable estimate. Nordic vowels included. */
const VOWELS = "aeiouyæøåäöü";

/**
 * Estimate syllables in a line ≈ count of vowel groups. Crude but stable and
 * language-agnostic enough for *comparing* two lines (we care about the delta,
 * not the absolute). A trailing silent "e" (English) is lightly discounted.
 */
export function syllableCount(line: string, language = "en"): number {
  const word = (w: string): number => {
    let groups = 0;
    let inVowel = false;
    for (const ch of w.toLowerCase()) {
      const isVowel = VOWELS.includes(ch);
      if (isVowel && !inVowel) groups++;
      inVowel = isVowel;
    }
    // English silent terminal "e" ("grace" = 1, not 2) — only when >1 group.
    // Test against the letters-only form so trailing punctuation ("grace,") does
    // not hide the terminal e and inflate the count.
    const letters = w.replace(/[^a-zæøåäöü]/gi, "");
    if (language.startsWith("en") && groups > 1 && /e$/i.test(letters) && !/le$/i.test(letters)) groups--;
    return Math.max(letters ? 1 : 0, groups);
  };
  return line
    .split(/\s+/)
    .filter(Boolean)
    .reduce((sum, w) => sum + word(w), 0);
}

/** Non-empty lyric lines, trimmed. Blank lines (stanza breaks) are dropped for metrics. */
export function lyricLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

export interface LineMetric {
  source: string;
  translated: string;
  source_syllables: number;
  translated_syllables: number;
}

export interface SingabilityReport {
  /** 0..1 — 1 = line count + syllables match the original closely. */
  confidence: number;
  warnings: string[];
  lines: LineMetric[];
}

/**
 * Compare a draft against the original line-for-line. Pure. Confidence falls
 * with line-count mismatch and with average per-line syllable drift; warnings
 * call out the worst offenders so a reviewer knows where to look.
 */
export function assessSingability(
  sourceText: string,
  translatedText: string,
  sourceLanguage = "en",
  targetLanguage = "no",
): SingabilityReport {
  const src = lyricLines(sourceText);
  const tgt = lyricLines(translatedText);
  const warnings: string[] = [];

  if (tgt.length !== src.length) {
    warnings.push(`Line count differs: original ${src.length}, draft ${tgt.length} — the melody may not fit.`);
  }

  const n = Math.min(src.length, tgt.length);
  const lines: LineMetric[] = [];
  let driftTotal = 0;
  let bigDrifts = 0;
  for (let i = 0; i < n; i++) {
    const s = syllableCount(src[i]!, sourceLanguage);
    const t = syllableCount(tgt[i]!, targetLanguage);
    const drift = Math.abs(s - t);
    driftTotal += drift;
    if (drift >= 3) bigDrifts++;
    lines.push({ source: src[i]!, translated: tgt[i]!, source_syllables: s, translated_syllables: t });
  }

  const avgDrift = n > 0 ? driftTotal / n : 0;
  if (bigDrifts > 0) {
    warnings.push(`${bigDrifts} line(s) differ by 3+ syllables — those will be hard to sing to the tune.`);
  }

  // Confidence: line-count penalty + syllable-drift penalty, clamped.
  const lineCountPenalty = src.length === 0 ? 1 : Math.abs(src.length - tgt.length) / src.length;
  const driftPenalty = Math.min(1, avgDrift / 4); // 4+ avg syllable drift ⇒ fully penalized
  const confidence = Math.max(0, Math.min(1, 1 - 0.5 * lineCountPenalty - 0.5 * driftPenalty));

  return { confidence: Number(confidence.toFixed(3)), warnings, lines };
}

export interface TranslatableContext {
  copyright_status: CopyrightStatus;
  /** True when the lyrics came from a Sunday user's own upload (they assert rights). */
  user_uploaded: boolean;
}

/**
 * Copyright gate. We may draft a translation only from public-domain lyrics or
 * lyrics the user uploaded themselves (Phase 4.2: "must be user-uploaded or
 * public domain — we don't re-translate CCLI-licensed content"). Pure.
 */
export function canTranslate(ctx: TranslatableContext): { allowed: boolean; reason?: string } {
  if (ctx.copyright_status === "public_domain") return { allowed: true };
  if (ctx.user_uploaded) return { allowed: true };
  if (ctx.copyright_status === "copyrighted") {
    return { allowed: false, reason: "This song is copyrighted and not your upload — we don't re-translate licensed content. Link to an official translation instead." };
  }
  return { allowed: false, reason: "Copyright status is unknown. Confirm the song is public domain or upload it as your own to draft a translation." };
}

/** Content-quality gate: refuse to draft from too-thin or garbage input. Pure. */
export function isTranslatableQuality(sourceText: string): { ok: boolean; reason?: string } {
  const lines = lyricLines(sourceText);
  if (lines.length < 2) return { ok: false, reason: "Need at least two lines of lyrics to draft a singable translation." };
  const letters = sourceText.replace(/[^a-zæøåäöü]/gi, "").length;
  if (letters < 20) return { ok: false, reason: "Lyrics look too short or corrupted to translate." };
  return { ok: true };
}

export interface DraftTranslationRequest {
  source_title: string;
  source_lyrics: string;
  source_language: string;
  target_language: string;
  /** e.g. "traditional Norwegian hymnal style" or "contemporary lovsang". */
  style?: string;
  context: TranslatableContext;
}

export const TRANSLATION_DISCLAIMER =
  "AI-generated draft. Review and refine — especially singability and theology — before any church use.";

export interface TranslationDraft {
  target_language: string;
  title: string;
  /** Translated lyrics as text (blank lines = stanza breaks preserved). */
  lyrics: string;
  singability: SingabilityReport;
  warnings: string[];
  model: string;
  disclaimer: string;
}

export const TRANSLATION_SYSTEM_PROMPT =
  "You translate worship songs and hymns so they remain SINGABLE to the original melody. " +
  "Match the original's number of lines and, as closely as possible, each line's syllable count and stress. " +
  "Preserve meaning, biblical allusions, and theological intent — never invent doctrine. Keep rhyme where natural, " +
  "never at the cost of meaning. Respond with ONLY a JSON object, no prose before or after.";

/** Build the user message. Pure — embeds per-line syllable targets so the model has the constraint. */
export function buildTranslationPrompt(req: DraftTranslationRequest): string {
  const src = lyricLines(req.source_lyrics);
  const withCounts = src.map((l) => `  (${syllableCount(l, req.source_language)}) ${l}`).join("\n");
  return [
    `Translate this song from ${req.source_language} to ${req.target_language}.`,
    req.style ? `Style: ${req.style}.` : null,
    `Title: ${req.source_title}`,
    "",
    "Source lyrics — the number in parentheses is that line's syllable count; aim to match it:",
    withCounts,
    "",
    "Return JSON exactly of this shape:",
    '{ "title": "<translated title>", "lyrics": "<translated lyrics, one line per source line, \\n between lines>" }',
    `Keep exactly ${src.length} lyric lines, in the same order.`,
  ]
    .filter((x) => x !== null)
    .join("\n");
}

/** Parse the model reply into { title, lyrics }. Pure; tolerant of fences/prose. Null when unusable. */
export function parseTranslationResponse(raw: string): { title: string; lyrics: string } | null {
  const start = raw.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  let end = -1;
  for (let i = start; i < raw.length; i++) {
    const ch = raw[i]!;
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) {
      end = i + 1;
      break;
    }
  }
  if (end === -1) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(start, end));
  } catch {
    return null;
  }
  const obj = parsed as { title?: unknown; lyrics?: unknown };
  if (typeof obj.lyrics !== "string" || !obj.lyrics.trim()) return null;
  const title = typeof obj.title === "string" && obj.title.trim() ? obj.title.trim() : "";
  return { title, lyrics: obj.lyrics.trim() };
}

export class TranslationRefused extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "TranslationRefused";
  }
}

/**
 * Draft a singable translation. Runs the copyright + quality gates first
 * (throwing `TranslationRefused` so the API maps it to a clean 4xx), then the
 * LLM, then the pure singability assessment. A missing client throws — this is
 * a Pro feature that genuinely needs the model.
 */
export async function draftTranslation(req: DraftTranslationRequest, client: LlmClient | null): Promise<TranslationDraft> {
  const gate = canTranslate(req.context);
  if (!gate.allowed) throw new TranslationRefused(gate.reason!);
  const quality = isTranslatableQuality(req.source_lyrics);
  if (!quality.ok) throw new TranslationRefused(quality.reason!);
  if (!client) throw new TranslationRefused("AI translation requires a configured Anthropic key (Sunday Pro).");

  const raw = await client.complete([{ role: "user", content: buildTranslationPrompt(req) }], {
    system: TRANSLATION_SYSTEM_PROMPT,
    temperature: 0.4,
    maxTokens: 2048,
  });
  const parsed = parseTranslationResponse(raw);
  if (!parsed) throw new TranslationRefused("The translation model returned an unusable response. Try again.");

  const singability = assessSingability(req.source_lyrics, parsed.lyrics, req.source_language, req.target_language);
  return {
    target_language: req.target_language,
    title: parsed.title || req.source_title,
    lyrics: parsed.lyrics,
    singability,
    warnings: singability.warnings,
    model: client.model,
    disclaimer: TRANSLATION_DISCLAIMER,
  };
}
