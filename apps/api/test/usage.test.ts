/**
 * Tests for the Stage/Plan → Song usage bridge — POST /v1/usage/log.
 *
 * The route records a usage event (the canonical `@sunday/contracts` UsageEvent,
 * vendored in `@sundaysong/shared`) and dedupes on `idempotency_key` so a
 * re-sent event never double-counts — the critical property for CCLI + TONO
 * reporting.
 *
 * All tests are offline — no Postgres. We inject an in-memory `record` fake via
 * `createUsageRoutes`, mirroring the dependency-injection seam other routes use
 * to bypass the DB. Events are built with `buildUsageEvent` so the wire shape
 * conforms to the canonical contract, exactly as SundayStage/Plan would emit.
 */

import { describe, expect, test } from "bun:test";

import { buildUsageEvent, makeUsageIdempotencyKey, UsageEvent, SCHEMA_VERSION } from "@sundaysong/shared";
import type { LogUsageInput } from "@sundaysong/db";
import { createUsageRoutes } from "../src/routes/usage";

// ── In-memory record fake ──────────────────────────────────────────────────

/**
 * Mirrors the DB `logUsage`'s idempotent insert: the first time we see an
 * `idempotency_key` we record it (logged=true); a re-send is a no-op
 * (logged=false). Captures rows so tests can assert what was written.
 */
function memoryRecorder() {
  const seen = new Set<string>();
  const rows: LogUsageInput[] = [];
  const record = async (event: LogUsageInput): Promise<{ logged: boolean }> => {
    if (seen.has(event.idempotency_key)) return { logged: false };
    seen.add(event.idempotency_key);
    rows.push(event);
    return { logged: true };
  };
  return { record, rows };
}

const post = (routes: ReturnType<typeof createUsageRoutes>, body: unknown) =>
  routes.request("/log", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

// Deterministic inputs → a stable idempotency key.
const baseInput = {
  churchId: "11111111-1111-1111-1111-111111111111",
  songId: "22222222-2222-2222-2222-222222222222",
  serviceDate: "2026-05-31",
  wasStreamed: true,
  serviceId: "33333333",
  serviceItemId: "7",
};

// ── buildUsageEvent → wire shape ─────────────────────────────────────────────

describe("buildUsageEvent (vendored @sunday/contracts)", () => {
  test("derives a stable idempotency key from service + item", () => {
    const e = buildUsageEvent(baseInput);
    expect(e.idempotency_key).toBe(makeUsageIdempotencyKey("33333333", "7"));
    expect(e.idempotency_key).toBe("svc-33333333:item-7");
  });

  test("carries the schema version and nulls optional fields", () => {
    const e = buildUsageEvent(baseInput);
    expect(e.schema_version).toBe(SCHEMA_VERSION);
    expect(e.variant_id).toBeNull();
    expect(e.duration_displayed_sec).toBeNull();
    expect(e.was_streamed).toBe(true);
  });

  test("a built event round-trips through the canonical schema", () => {
    const e = buildUsageEvent({ ...baseInput, variantId: "44444444-4444-4444-4444-444444444444", durationDisplayedSec: 240 });
    expect(UsageEvent.parse(e)).toEqual(e);
  });
});

// ── POST /v1/usage/log ───────────────────────────────────────────────────────

describe("POST /v1/usage/log", () => {
  test("200 + logged=true on first send of a built event", async () => {
    const { record, rows } = memoryRecorder();
    const routes = createUsageRoutes(record);

    const event = buildUsageEvent(baseInput);
    const res = await post(routes, event);

    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; idempotency_key: string; logged: boolean };
    expect(json.ok).toBe(true);
    expect(json.logged).toBe(true);
    expect(json.idempotency_key).toBe(event.idempotency_key);
    expect(json.idempotency_key).toBe("svc-33333333:item-7");
    expect(rows).toHaveLength(1);
  });

  test("re-sending the same event dedupes (logged=false, recorded once)", async () => {
    const { record, rows } = memoryRecorder();
    const routes = createUsageRoutes(record);

    const event = buildUsageEvent(baseInput);

    const first = (await (await post(routes, event)).json()) as { logged: boolean };
    expect(first.logged).toBe(true);

    // Same service item, even with a different was_streamed → same key → no-op.
    const retry = buildUsageEvent({ ...baseInput, wasStreamed: false });
    expect(retry.idempotency_key).toBe(event.idempotency_key);

    const second = (await (await post(routes, retry)).json()) as { logged: boolean; idempotency_key: string };
    expect(second.logged).toBe(false);
    expect(second.idempotency_key).toBe(event.idempotency_key);

    // The store recorded the event exactly once.
    expect(rows).toHaveLength(1);
  });

  test("a different service item is a distinct, separately-logged event", async () => {
    const { record, rows } = memoryRecorder();
    const routes = createUsageRoutes(record);

    const a = buildUsageEvent(baseInput);
    const b = buildUsageEvent({ ...baseInput, serviceItemId: "8" });
    expect(b.idempotency_key).not.toBe(a.idempotency_key);

    const ra = (await (await post(routes, a)).json()) as { logged: boolean };
    const rb = (await (await post(routes, b)).json()) as { logged: boolean };
    expect(ra.logged).toBe(true);
    expect(rb.logged).toBe(true);
    expect(rows).toHaveLength(2);
  });

  test("400 on a malformed event (missing required fields)", async () => {
    const { record } = memoryRecorder();
    const routes = createUsageRoutes(record);

    // Missing church_id / song_id / was_streamed etc.
    const res = await post(routes, { idempotency_key: "svc-1:item-1" });
    expect(res.status).toBe(400);
  });

  test("400 when church_id is not a UUID", async () => {
    const { record } = memoryRecorder();
    const routes = createUsageRoutes(record);

    const bad = { ...buildUsageEvent(baseInput), church_id: "not-a-uuid" };
    const res = await post(routes, bad);
    expect(res.status).toBe(400);
  });

  test("accepts an event without schema_version (defaults to current)", async () => {
    const { record, rows } = memoryRecorder();
    const routes = createUsageRoutes(record);

    // Older emitters may not send schema_version; the field defaults.
    const { schema_version: _omit, ...withoutVersion } = buildUsageEvent(baseInput);
    const res = await post(routes, withoutVersion);

    expect(res.status).toBe(200);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.idempotency_key).toBe("svc-33333333:item-7");
  });
});
