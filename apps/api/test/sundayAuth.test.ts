import { describe, expect, test } from "bun:test";
import { Hono } from "hono";

import { churchScoped } from "../src/middleware/sundayAuth";

/**
 * The opt-in wiring: with no SUNDAY_JWKS_URL / SUNDAY_AUTH_AUDIENCE configured
 * (the case in CI and dev), `churchScoped` must be a transparent pass-through
 * so the free/public surface and existing route behaviour stay intact. The
 * enforcing path is covered by the pure verifier + guard tests in auth.test.ts;
 * the remote-JWKS resolution is NETWORK-UNVERIFIED by design.
 *
 * NOTE: env vars are read once and cached on first call, so this file must not
 * set them — it asserts the unconfigured (no-op) contract.
 */
describe("churchScoped (auth not configured)", () => {
  test("passes through to the handler without a token", async () => {
    const app = new Hono();
    app.post("/log", churchScoped((c) => c.req.json().then((b: { church_id?: string }) => b.church_id)), (c) =>
      c.json({ ok: true }),
    );

    const res = await app.request("/log", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ church_id: "ch_1" }),
    });

    expect(res.status).toBe(200);
    expect(((await res.json()) as { ok: boolean }).ok).toBe(true);
  });

  test("the body remains readable by a downstream validator after the guard inspects it", async () => {
    // The resolver reads the JSON body; the handler must still be able to read
    // it too (Hono memoises c.req.json()).
    const app = new Hono();
    app.post(
      "/log",
      churchScoped((c) => c.req.json().then((b: { church_id?: string }) => b.church_id)),
      async (c) => c.json(await c.req.json()),
    );

    const res = await app.request("/log", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ church_id: "ch_42", n: 7 }),
    });

    expect(res.status).toBe(200);
    expect((await res.json()) as { church_id: string; n: number }).toEqual({ church_id: "ch_42", n: 7 });
  });
});
