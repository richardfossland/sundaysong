import { Hono } from "hono";

import { churchScoped } from "../middleware/sundayAuth";
import { getClaims } from "../middleware/auth";

/**
 * Sunday Account pilot route — the cross-app SSO smoke test.
 *
 * `GET /v1/account/whoami?church_id=<uuid>` is guarded by `churchScoped`, so it
 * exercises the whole identity loop end-to-end: a desktop app (SundayRec) logs
 * into Supabase, gets a JWT stamped with `church_ids`/`app_grants` by the
 * SundayPlan token hook, and calls this endpoint with it. SundaySong verifies
 * the JWT against the issuer JWKS (`requireAuth`) and checks the caller is a
 * member of the requested church (`requireChurch`), then echoes the claims back.
 *
 * Opt-in like every other church-scoped route: until the platform JWKS is
 * configured (`SUNDAY_JWKS_URL` + `SUNDAY_AUTH_AUDIENCE`) `churchScoped` is a
 * transparent pass-through, so the dev surface returns 200 with
 * `authenticated:false`. Once configured it enforces (401 / 403).
 */
export function createAccountRoutes(): Hono {
  const routes = new Hono();

  routes.get(
    "/whoami",
    churchScoped((c) => c.req.query("church_id")),
    (c) => {
      const claims = getClaims(c);
      const churchId = c.req.query("church_id") ?? null;
      return c.json({
        ok: true,
        church_id: churchId,
        // Present only when auth is configured + the token verified.
        authenticated: claims != null,
        sub: claims?.sub ?? null,
        church_ids: claims?.church_ids ?? [],
      });
    },
  );

  return routes;
}

/** The wired router mounted by the API server. */
export const accountRoutes = createAccountRoutes();
