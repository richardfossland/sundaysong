/**
 * Offline tests for the /recommendations/set page logic (use case E). Pure —
 * no DOM, no API; exercises validateSetForm + the formatting helpers directly.
 */

import { describe, expect, test } from "bun:test";
import type { RecommendSetOutput } from "@sundaysong/sdk";
import {
  validateSetForm,
  formatSetDuration,
  setKeyFlow,
  setSummaryLine,
  energyLabel,
  EMPTY_SET_FORM,
  type SetFormState,
} from "../lib/recommendSet";

const form = (over: Partial<SetFormState> = {}): SetFormState => ({ ...EMPTY_SET_FORM, ...over });

describe("validateSetForm", () => {
  test("requires at least one intent field", () => {
    const v = validateSetForm(form({ theme: "", scripture: "", description: "" }));
    expect(v.ok).toBe(false);
  });

  test("projects theme + size + arc onto a RecommendSetInput", () => {
    const v = validateSetForm(form({ theme: "grace", arc: "rising", sizeMode: "size", targetSize: "5" }));
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.input.theme).toBe("grace");
      expect(v.input.arc).toBe("rising");
      expect(v.input.target_size).toBe(5);
      expect(v.input.target_duration_min).toBeUndefined();
    }
  });

  test("duration mode sends target_duration_min, not target_size", () => {
    const v = validateSetForm(form({ theme: "grace", sizeMode: "duration", targetDurationMin: "24" }));
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.input.target_duration_min).toBe(24);
      expect(v.input.target_size).toBeUndefined();
    }
  });

  test("rejects a non-positive size", () => {
    expect(validateSetForm(form({ theme: "x", targetSize: "0" })).ok).toBe(false);
    expect(validateSetForm(form({ theme: "x", targetSize: "-2" })).ok).toBe(false);
  });

  test("maps major % to a 0..1 ratio and drops the empty constraint", () => {
    const v = validateSetForm(form({ theme: "x", majorPct: "60", maxBpmJump: "" }));
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.input.constraints?.major_ratio).toBeCloseTo(0.6, 5);
      expect(v.input.constraints?.max_bpm_jump).toBeUndefined();
    }
  });

  test("rejects a major % outside 0..100", () => {
    expect(validateSetForm(form({ theme: "x", majorPct: "150" })).ok).toBe(false);
  });

  test("rejects a non-positive max tempo jump", () => {
    expect(validateSetForm(form({ theme: "x", maxBpmJump: "0" })).ok).toBe(false);
  });

  test("omits the constraints object entirely when none given", () => {
    const v = validateSetForm(form({ theme: "x", maxBpmJump: "", majorPct: "" }));
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.input.constraints).toBeUndefined();
  });
});

describe("formatting helpers", () => {
  const out = (over: Partial<RecommendSetOutput> = {}): RecommendSetOutput => ({
    slots: [],
    total_minutes_estimate: 20,
    major_ratio: 0.5,
    trajectory: { energy: [0.2, 0.8], target_energy: [0, 1], keys: ["C", "G"], bpm: [70, 100] },
    tempo_violations: 0,
    summary: "",
    arc: "rising",
    ...over,
  });

  test("formatSetDuration handles minutes and hours", () => {
    expect(formatSetDuration(23)).toBe("23 min");
    expect(formatSetDuration(60)).toBe("1 h");
    expect(formatSetDuration(65)).toBe("1 h 5 min");
  });

  test("setKeyFlow drops nulls", () => {
    expect(setKeyFlow(out({ trajectory: { energy: [], target_energy: [], keys: ["C", null, "G"], bpm: [] } }))).toEqual(["C", "G"]);
  });

  test("setSummaryLine includes arc, count, duration and major %", () => {
    const line = setSummaryLine(out({ slots: [{} as never, {} as never] }));
    expect(line).toContain("Rising");
    expect(line).toContain("2 songs");
    expect(line).toContain("20 min");
    expect(line).toContain("50% major");
  });

  test("energyLabel buckets 0..1", () => {
    expect(energyLabel(0.1)).toBe("low");
    expect(energyLabel(0.5)).toBe("mid");
    expect(energyLabel(0.9)).toBe("high");
  });
});
