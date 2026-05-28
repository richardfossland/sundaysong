import { describe, expect, test } from "bun:test";
import { runSync, type RunSyncDeps } from "../src/orchestrator";
import { TestConnector, TEST_CATALOG_SIZE } from "../src/testConnector";
import type { NormalizedSong } from "../src/types";

/** In-memory upsert store keyed on source_external_id (the idempotency anchor). */
function makeStore() {
  const rows = new Map<string, NormalizedSong>();
  const upsert: RunSyncDeps["upsert"] = async (song) => {
    const key = `${song.source}:${song.source_external_id}`;
    const isNew = !rows.has(key);
    rows.set(key, song);
    return isNew ? "added" : "updated";
  };
  return { rows, upsert };
}

/** Deterministic, instant deps: no real time, no jitter, no sleeping. */
function instantDeps(upsert: RunSyncDeps["upsert"]): RunSyncDeps {
  return { upsert, now: () => 0, sleep: async () => {}, rand: () => 0 };
}

describe("runSync — happy path", () => {
  test("imports the whole catalog and reports succeeded", async () => {
    const { rows, upsert } = makeStore();
    const { run, imported, deadLetter } = await runSync(new TestConnector(), instantDeps(upsert));
    expect(run.status).toBe("succeeded");
    expect(run.songs_added).toBe(TEST_CATALOG_SIZE);
    expect(run.songs_updated).toBe(0);
    expect(imported).toHaveLength(TEST_CATALOG_SIZE);
    expect(deadLetter).toHaveLength(0);
    expect(rows.size).toBe(TEST_CATALOG_SIZE);
  });
});

describe("runSync — retries", () => {
  test("a flaky item that recovers within budget is still imported", async () => {
    const { rows, upsert } = makeStore();
    const connector = new TestConnector({ failTransientTimes: { t3: 2 } });
    const { run } = await runSync(connector, instantDeps(upsert));
    expect(run.status).toBe("succeeded");
    expect(rows.has("test:t3")).toBe(true);
    expect(run.songs_added).toBe(TEST_CATALOG_SIZE);
  });

  test("a transient error that never clears is dead-lettered after the budget", async () => {
    const { upsert } = makeStore();
    const connector = new TestConnector({ failTransientTimes: { t4: 99 } });
    const { run, deadLetter } = await runSync(connector, instantDeps(upsert), {
      retry: { baseMs: 1, maxMs: 2, factor: 2, maxAttempts: 3 },
    });
    expect(run.status).toBe("partial");
    expect(run.songs_added).toBe(TEST_CATALOG_SIZE - 1);
    expect(deadLetter).toHaveLength(1);
    expect(deadLetter[0]).toMatchObject({ external_id: "t4", kind: "transient", attempts: 3 });
  });
});

describe("runSync — dead-letter + idempotency", () => {
  test("a permanent failure is dead-lettered, the rest import, status is partial", async () => {
    const { rows, upsert } = makeStore();
    const connector = new TestConnector({ failPermanent: ["t6"] });
    const { run, deadLetter } = await runSync(connector, instantDeps(upsert));
    expect(run.status).toBe("partial");
    expect(run.songs_added).toBe(TEST_CATALOG_SIZE - 1);
    expect(rows.has("test:t6")).toBe(false);
    expect(deadLetter[0]).toMatchObject({ external_id: "t6", kind: "permanent" });
  });

  test("re-running against the same store updates rather than duplicates", async () => {
    const { rows, upsert } = makeStore();
    await runSync(new TestConnector(), instantDeps(upsert));
    const second = await runSync(new TestConnector(), instantDeps(upsert));
    expect(second.run.status).toBe("succeeded");
    expect(second.run.songs_added).toBe(0);
    expect(second.run.songs_updated).toBe(TEST_CATALOG_SIZE);
    expect(rows.size).toBe(TEST_CATALOG_SIZE); // no duplicates
  });
});

describe("runSync — rate limiting", () => {
  test("throttles without losing correctness (fake clock advanced by sleep)", async () => {
    const { rows, upsert } = makeStore();
    let t = 0;
    const deps: RunSyncDeps = {
      upsert,
      now: () => t,
      sleep: async (ms) => { t += ms; },
      rand: () => 0,
    };
    const { run } = await runSync(new TestConnector(), deps, {
      rateLimit: { ratePerSec: 5, capacity: 5 },
      concurrency: 3,
    });
    expect(run.status).toBe("succeeded");
    expect(rows.size).toBe(TEST_CATALOG_SIZE);
    expect(t).toBeGreaterThan(0); // some throttling actually happened
  });
});
