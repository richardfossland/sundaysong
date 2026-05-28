import { describe, expect, test } from "bun:test";
import { startRun, recordAdded, recordUpdated, recordError, finishRun } from "../src/syncRun";
import type { SyncError } from "../src/types";

const ERR: SyncError = { external_id: "x", message: "boom", kind: "permanent", attempts: 1 };

describe("sync-run state machine", () => {
  test("clean run resolves to succeeded", () => {
    let s = startRun("test", 1000);
    s = recordAdded(s);
    s = recordUpdated(s);
    s = finishRun(s, 2000);
    expect(s.status).toBe("succeeded");
    expect(s.songs_added).toBe(1);
    expect(s.songs_updated).toBe(1);
    expect(s.finished_at_ms).toBe(2000);
  });

  test("progress with dead-letters resolves to partial", () => {
    let s = startRun("test", 0);
    s = recordAdded(s);
    s = recordError(s, ERR);
    s = finishRun(s, 1);
    expect(s.status).toBe("partial");
    expect(s.errors).toHaveLength(1);
  });

  test("errors with no progress resolves to failed", () => {
    let s = startRun("test", 0);
    s = recordError(s, ERR);
    s = finishRun(s, 1);
    expect(s.status).toBe("failed");
  });

  test("updates are immutable (no mutation of prior state)", () => {
    const a = startRun("test", 0);
    const b = recordAdded(a);
    expect(a.songs_added).toBe(0);
    expect(b.songs_added).toBe(1);
  });
});
