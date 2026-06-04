/**
 * Pure, framework-free logic for the /recommendations/season page.
 *
 * Kept out of the React component so it can be unit-tested under `bun test`
 * with no DOM, API or network — the same offline-first discipline the rest of
 * the web app and the API routes follow. The component imports `SEASONS` and
 * `seasonLabel`; the tests exercise the helpers directly.
 */

import type { LiturgicalSeason, RecommendSeasonInput } from "@sundaysong/sdk";

/**
 * The selectable liturgical seasons, in calendar order, with display labels.
 * Mirrors `LiturgicalSeasonSchema` in @sundaysong/shared — if a season is added
 * there it should be added here too (the typed `value` keeps them in sync at
 * compile time).
 */
export const SEASONS: Array<{ value: LiturgicalSeason; label: string }> = [
  { value: "Advent", label: "Advent" },
  { value: "Christmas", label: "Christmas" },
  { value: "Epiphany", label: "Epiphany" },
  { value: "Lent", label: "Lent" },
  { value: "HolyWeek", label: "Holy Week" },
  { value: "Easter", label: "Easter" },
  { value: "Pentecost", label: "Pentecost" },
  { value: "Trinity", label: "Trinity" },
  { value: "AllSaints", label: "All Saints" },
  { value: "OrdinaryTime", label: "Ordinary Time" },
];

/** Human-readable label for a season slug, falling back to the slug itself. */
export function seasonLabel(season: LiturgicalSeason): string {
  return SEASONS.find((s) => s.value === season)?.label ?? season;
}

/** Build the API input from a chosen season + optional language. */
export function buildSeasonInput(
  season: LiturgicalSeason,
  language: string,
): RecommendSeasonInput {
  const input: RecommendSeasonInput = { season };
  const lang = language.trim();
  if (lang) input.language = lang;
  return input;
}
