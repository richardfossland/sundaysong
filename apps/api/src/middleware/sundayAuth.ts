/**
 * Wiring for the opt-in Sunday auth (see auth.ts for the pure verifier).
 *
 * Auth is OPT-IN and config-gated so the public free tier keeps working with
 * no token and the existing route tests stay green: when the platform JWKS
 * isn't configured (`SUNDAY_JWKS_URL` + `SUNDAY_AUTH_AUDIENCE`), the church
 * guard is a transparent pass-through. Once the Sunday account service is live
 * and those env vars are set, the same routes start enforcing.
 *
 * NETWORK-UNVERIFIED: the production path resolves keys via a remote JWKS
 * (`createRemoteJWKSet`) over HTTPS. That call is wired and compiles but cannot
 * be exercised here (no network); the pure verifier + the guard logic ARE unit
 * tested (auth.test.ts) against a locally generated RS256 key set.
 */

import type { Context, MiddlewareHandler, Next } from "hono";
import { createRemoteJWKSet } from "jose";

import { createVerifier, requireAuth, requireChurch, type Verifier } from "./auth";

let cached: { verify: Verifier } | null | undefined;

/** Build (once) the verifier from env, or null when auth isn't configured. */
function configuredVerifier(): { verify: Verifier } | null {
  if (cached !== undefined) return cached;

  const jwksUrl = Bun.env.SUNDAY_JWKS_URL;
  const audience = Bun.env.SUNDAY_AUTH_AUDIENCE;
  if (!jwksUrl || !audience) {
    cached = null;
    return cached;
  }

  // NETWORK-UNVERIFIED: remote JWKS fetch + cache happens inside jose.
  const keys = createRemoteJWKSet(new URL(jwksUrl));
  const verify = createVerifier({ keys, audience, issuer: Bun.env.SUNDAY_AUTH_ISSUER });
  cached = { verify };
  return cached;
}

/**
 * Opt-in auth for a church-scoped route. When configured it runs
 * `requireAuth` + `requireChurch(resolve)`; when not configured it is a no-op
 * so the route behaves exactly as before (public/dev). `resolve` extracts the
 * target church id from the request (e.g. from the validated JSON body).
 */
export function churchScoped(resolve?: (c: Context) => string | undefined | Promise<string | undefined>): MiddlewareHandler {
  return async (c: Context, next: Next) => {
    const cfg = configuredVerifier();
    if (!cfg) return next(); // auth not configured → stay open

    const auth = requireAuth(cfg.verify);
    const church = requireChurch(resolve);
    // Chain the two guards by hand. A guard that denies returns a Response; we
    // surface it via `c.res` so the chain short-circuits and the handler (the
    // real `next`) never runs.
    return auth(c, async () => {
      const denied = await church(c, next);
      if (denied instanceof Response) c.res = denied;
    });
  };
}
