/**
 * Sunday account auth (Phase 5.1) — Bearer JWT validation against a JWKS.
 *
 * This is OPT-IN per route. The public free tier (search, recommend) must keep
 * working with no token, so it is NOT installed globally — only church-scoped
 * routes (usage, licensing) mount `requireAuth` + `requireChurch`.
 *
 * The token + claim shape mirror `@sunday/auth-client`:
 *   - `sub`         the Sunday account id (subject)
 *   - `church_ids`  the churches this account may act for
 *   - `app_grants`  per-church enabled app grants, `{ "<church_id>": ["stage","rec"] }`
 *
 * `app_grants` is the EXACT shape the SundayPlan `custom_access_token_hook`
 * (migration 0010) stamps — a per-church map, not a flat list (an earlier flat
 * `string[]` reading silently dropped every grant). Church scope is still
 * enforced via `church_ids` (`requireChurch`); `app_grants` is available for
 * future per-app gating via `hasAppGrant`. The remaining convergence step —
 * physically importing `@sunday/auth-client` instead of duplicating this here —
 * waits on publishing the sunday-platform git tag (it crosses a jose v5/v6
 * boundary); the claim SHAPE now matches the canonical package exactly.
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
  /** Per-church enabled app grants, e.g. `{ "<church_id>": ["stage","rec"] }`. */
  app_grants: Record<string, string[]>;
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
 * Normalise the `app_grants` claim into a per-church map, defensively: a missing
 * or malformed claim becomes `{}`, non-array church entries are dropped, and
 * non-string app entries within a church are filtered out. Mirrors the
 * `extractSundayClaims` coercion in `@sunday/auth-client`.
 */
function asGrantMap(v: unknown): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  if (v && typeof v === "object" && !Array.isArray(v)) {
    for (const [church, apps] of Object.entries(v as Record<string, unknown>)) {
      if (Array.isArray(apps)) {
        out[church] = apps.filter((x): x is string => typeof x === "string");
      }
    }
  }
  return out;
}

/**
 * Build a verifier from an injected key set. Asymmetric only — ES256 (what
 * Supabase signs new projects with) or RS256 (RSA-keyed projects); a token
 * signed with any other algorithm (notably symmetric HS256) is rejected
 * rather than silently trusted. Pure aside from the crypto verify — no I/O of
 * our own, so it's fully unit-testable with a local key.
 */
export function createVerifier(opts: VerifierOptions): Verifier {
  return async (bearerToken: string): Promise<SundayClaims> => {
    const { payload } = await jwtVerify(bearerToken, opts.keys as Parameters<typeof jwtVerify>[1], {
      algorithms: ["ES256", "RS256"],
      audience: opts.audience,
      ...(opts.issuer ? { issuer: opts.issuer } : {}),
    });

    if (typeof payload.sub !== "string" || payload.sub.length === 0) {
      throw new errors.JWTClaimValidationFailed("missing subject", payload, "sub", "check_failed");
    }

    return {
      sub: payload.sub,
      church_ids: asStringArray((payload as Record<string, unknown>).church_ids),
      app_grants: asGrantMap((payload as Record<string, unknown>).app_grants),
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
/**
 * The reserved app-grant value that marks a Sunday user as a SundaySong
 * moderator/admin. Granted per church in SundayPlan's `app_grant` table
 * (migration 0018) and stamped into `app_grants` by the token hook — no
 * dedicated JWT claim, the existing pipeline carries it end to end.
 */
export const SONG_ADMIN_GRANT = "song_admin";

/**
 * Whether the claims carry the song_admin grant. The admin surface is
 * platform-global, so a grant in ANY church qualifies by default; set
 * `SUNDAY_SONG_ADMIN_CHURCH_ID` to pin which church's grants count (e.g. the
 * operator's own church) once multiple tenants exist.
 */
export function hasSongAdminGrant(
  claims: SundayClaims,
  pinnedChurchId?: string,
): boolean {
  if (pinnedChurchId) {
    return (claims.app_grants[pinnedChurchId] ?? []).includes(SONG_ADMIN_GRANT);
  }
  return Object.values(claims.app_grants).some((apps) => apps.includes(SONG_ADMIN_GRANT));
}

/**
 * Hono middleware: require the song_admin grant on already-verified claims.
 * Mount AFTER `requireAuth`. 401 without claims, 403 without the grant.
 */
export function requireSongAdmin(pinnedChurchId?: string): MiddlewareHandler {
  return async (c: Context, next: Next) => {
    const claims = getClaims(c);
    if (!claims) {
      return c.json({ error: "unauthorized", message: "Authentication required." }, 401);
    }
    if (!hasSongAdminGrant(claims, pinnedChurchId)) {
      return c.json(
        { error: "forbidden", message: "The song_admin grant is required for admin operations." },
        403,
      );
    }
    await next();
  };
}

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
