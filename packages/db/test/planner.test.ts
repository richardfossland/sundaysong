import { describe, expect, test } from "bun:test";
import { sortMigrations, computePending } from "../src/planner";

describe("sortMigrations", () => {
  test("orders numerically, not lexically", () => {
    const files = ["0010_x.sql", "0002_b.sql", "0001_a.sql", "0009_w.sql"];
    expect(sortMigrations(files)).toEqual(["0001_a.sql", "0002_b.sql", "0009_w.sql", "0010_x.sql"]);
  });

  test("drops non-sql files", () => {
    expect(sortMigrations(["0001_a.sql", "README.md", ".DS_Store", "notes.txt"])).toEqual(["0001_a.sql"]);
  });
});

describe("computePending", () => {
  test("returns only unapplied migrations, in order", () => {
    const all = ["0001_core.sql", "0002_sources.sql", "0003_seed.sql"];
    expect(computePending(all, ["0001_core.sql"])).toEqual(["0002_sources.sql", "0003_seed.sql"]);
  });

  test("empty when everything is applied", () => {
    const all = ["0001_core.sql", "0002_sources.sql"];
    expect(computePending(all, ["0002_sources.sql", "0001_core.sql"])).toEqual([]);
  });

  test("ignores recorded migrations no longer on disk", () => {
    expect(computePending(["0002_b.sql"], ["0001_a.sql", "0002_b.sql"])).toEqual([]);
  });
});
