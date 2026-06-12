import { describe, expect, test } from "bun:test";

import server from "../src/server";

/**
 * `/health` is the Fly.io http_service check target. It must be a pure
 * liveness probe: no auth, no database, no search dependency — it answers 200
 * the moment the process serves requests. (Deep dependency reporting lives at
 * `/health/deep` instead.) No DATABASE_URL / Meilisearch is configured in this
 * test run, which is exactly the point.
 */
describe("GET /health", () => {
  test("returns 200 {ok:true} with no auth and no database", async () => {
    const res = await server.fetch(new Request("http://localhost/health"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });
});
