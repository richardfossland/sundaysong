/**
 * Sunday account auth (Phase 5.1) — Bearer JWT validation against a JWKS.
 *
 * This is OPT-IN per route. The public free tier (search, recommend) must keep
 * working with no token, so it is NOT installed globally — only church-scoped
 * routes (usage, licensing) mount `requireAuth` + `requireChurch`.
 *
 * The token + claim shape mirror the not-yet-published `@sunday/auth-client`:
 *   - `sub`         the Sunday account id (subject)
 *   - `church_ids`  the churches this account may act for
 *   - `app_grants`  which Sunday products / scopes the account is granted
 * mirrors sunday-contracts; converge once published.
 *
 * The verifier is a FACTORY that takes its key set injected, so unit tests pass
 * a locally generated RS256 key set (`createLocalJWKSet`) and never touch the
 * network or a DB. Production wires a `createRemoteJWKSet(issuer/.well-known)`
 * resolver into the same factory.
 */

import type { Context, MiddlewareHandler, Next } from "hono";
import { jwtVerify, errors, type JWTPayload, type JWTVerifyGetKey, type CryptoKey, type KeyObject } from "jose";

/** Resolved Sunday claims attached to the request context once verified. */
export interface SundayClaims {
  /** Sunday account id (JWT `sub`). */
  sub: string;
  /** Churches the account may act for. Empty array if the claim is absent. */
  church_ids: string[];
  /** Granted products / scopes, e.g. ["song:read", "stage"]. */
  app_grants: string[];
  /** The raw verified payload, for callers that need extra claims. */
  raw: JWTPayload;
}

/** Context key under which verified claims are stored. */
const CLAIMS_KEY = "sundayClaims";

/** Read the verified claims off the context (after `requireAuth` has run). */
export function getClaims(c: Context): SundayClaims | undefined {
  return c.get(CLAIMS_KEY) as SundayClaims | undefined;
}

export interface VerifierOptions {
  /**
   * Key set: a JWKS resolver (`createLocalJWKSet`/`createRemoteJWKSet`) or a
   * single key. Injected so tests use a self-signed RS256 key with no network.
   */
  keys: JWTVerifyGetKey | CryptoKey | KeyObject | Uint8Array;
  /** Expected token audience (`aud`). Required — an unscoped token is rejected. */
  audience: string;
  /** Expected issuer (`iss`), when the platform pins one. */
  issuer?: string;
}

/** A pure verifier: bearer string → claims, or throws. Built by the factory. */
export type Verifier = (bearerToken: string) => Promise<SundayClaims>;

/** Normalise a claim that may be a string, an array, or absent into string[]. */
function asStringArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string");
  if (typeof v === "string" && v.length > 0) return [v];
  return [];
}

/**
 * Build a verifier from an injected key set. RS256 only (the Sunday platform
 * signs with RSA), so a token signed with any other algorithm is rejected
 * rather than silently trusted. Pure aside from the crypto verify — no I/O of
 * our own, so it's fully unit-testable with a local key.
 */
export function createVerifier(opts: VerifierOptions): Verifier {
  return async (bearerToken: string): Promise<SundayClaims> => {
    const { payload } = await jwtVerify(bearerToken, opts.keys as Parameters<typeof jwtVerify>[1], {
      algorithms: ["RS256"],
      audience: opts.audience,
      ...(opts.issuer ? { issuer: opts.issuer } : {}),
    });

    if (typeof payload.sub !== "string" || payload.sub.length === 0) {
      throw new errors.JWTClaimValidationFailed("missing subject", payload, "sub", "check_failed");
    }

    return {
      sub: payload.sub,
      church_ids: asStringArray((payload as Record<string, unknown>).church_ids),
      app_grants: asStringArray((payload as Record<string, unknown>).app_grants),
      raw: payload,
    };
  };
}

/** Pull the bearer token out of an Authorization header, or null. */
export function extractBearer(header: string | undefined | null): string | null {
  if (!header) return null;
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  return m ? m[1]!.trim() : null;
}

/**
 * Hono middleware: require a valid Bearer JWT. On success, the resolved
 * `SundayClaims` are stored on the context for `requireChurch` / handlers.
 * 401 when the token is missing or fails verification (expired / wrong key /
 * wrong audience / wrong algorithm / missing subject).
 */
export function requireAuth(verify: Verifier): MiddlewareHandler {
  return async (c: Context, next: Next) => {
    const token = extractBearer(c.req.header("authorization"));
    if (!token) {
      return c.json({ error: "unauthorized", message: "Missing Bearer token." }, 401);
    }
    try {
      const claims = await verify(token);
      c.set(CLAIMS_KEY, claims);
    } catch {
      // Don't leak the specific failure (expired vs wrong-key) to the caller.
      return c.json({ error: "unauthorized", message: "Invalid or expired token." }, 401);
    }
    await next();
  };
}

/**
 * Hono middleware: require that a church the request targets is in the token's
 * `church_ids`. The church id is read from (in order): the resolver you pass,
 * the `church_id` route param, or the `church_id` query param. 403 if the
 * resolved church isn't granted; 401 if `requireAuth` hasn't run / no claims.
 *
 * For body-scoped routes (the church id lives in the JSON body) pass a
 * `resolve` that returns it — keep it cheap and synchronous-feeling.
 */
export function requireChurch(resolve?: (c: Context) => string | undefined | Promise<string | undefined>): MiddlewareHandler {
  return async (c: Context, next: Next) => {
    const claims = getClaims(c);
    if (!claims) {
      return c.json({ error: "unauthorized", message: "Authentication required." }, 401);
    }

    const churchId =
      (resolve ? await resolve(c) : undefined) ??
      c.req.param("church_id") ??
      c.req.query("church_id");

    if (!churchId) {
      return c.json({ error: "bad_request", message: "No church_id on the request." }, 400);
    }
    if (!claims.church_ids.includes(churchId)) {
      return c.json({ error: "forbidden", message: "Token is not granted for this church." }, 403);
    }
    await next();
  };
}
