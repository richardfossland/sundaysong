/**
 * Tests for the /recommendations/season page logic — the season catalog and
 * the input builder — run OFFLINE under `bun test` with no DOM, API or network.
 */

import { describe, expect, test } from "bun:test";

import { LiturgicalSeasonSchema } from "@sundaysong/shared";
import { buildSeasonInput, seasonLabel, SEASONS } from "@/lib/recommendSeason";

describe("SEASONS catalog", () => {
  test("covers exactly the schema's liturgical seasons", () => {
    const fromSchema = [...LiturgicalSeasonSchema.options].sort();
    const fromUi = SEASONS.map((s) => s.value).sort();
    expect(fromUi).toEqual(fromSchema);
  });

  test("every season has a non-empty label", () => {
    for (const s of SEASONS) expect(s.label.length).toBeGreaterThan(0);
  });
});

describe("seasonLabel", () => {
  test("maps a slug to its display label", () => {
    expect(seasonLabel("HolyWeek")).toBe("Holy Week");
    expect(seasonLabel("Advent")).toBe("Advent");
  });
});

describe("buildSeasonInput", () => {
  test("includes the season and drops a blank language", () => {
    expect(buildSeasonInput("Easter", "  ")).toEqual({ season: "Easter" });
  });

  test("carries a trimmed language through", () => {
    expect(buildSeasonInput("Lent", "  no  ")).toEqual({ season: "Lent", language: "no" });
  });
});
