import { describe, expect, test, beforeAll } from "bun:test";
import { Hono } from "hono";
import { SignJWT, exportJWK, generateKeyPair, createLocalJWKSet, type KeyLike, type JWK } from "jose";

import { createVerifier, requireAuth, requireChurch, getClaims, extractBearer } from "../src/middleware/auth";

/**
 * Unit tests use a locally generated RS256 keypair fed through a JWKS — no
 * network, no DB. We sign tokens with the matching private key and verify
 * against the public key set, exactly as production would against the Sunday
 * platform's published JWKS.
 */

const AUD = "sundaysong";
const ISS = "https://accounts.sunday.test";

let priv: KeyLike;
let kid: string;
let jwks: ReturnType<typeof createLocalJWKSet>;
let wrongJwks: ReturnType<typeof createLocalJWKSet>;

async function makeKeyset(): Promise<{ privateKey: KeyLike; getKey: ReturnType<typeof createLocalJWKSet>; kid: string }> {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const jwk = (await exportJWK(publicKey)) as JWK;
  jwk.kid = crypto.randomUUID();
  jwk.alg = "RS256";
  jwk.use = "sig";
  return { privateKey, getKey: createLocalJWKSet({ keys: [jwk] }), kid: jwk.kid };
}

beforeAll(async () => {
  const main = await makeKeyset();
  priv = main.privateKey;
  kid = main.kid;
  jwks = main.getKey;
  // A second, unrelated key set — tokens signed by `priv` must NOT verify here.
  wrongJwks = (await makeKeyset()).getKey;
});

function sign(
  claims: Record<string, unknown>,
  opts: { aud?: string; iss?: string; expiresIn?: string; key?: KeyLike } = {},
): Promise<string> {
  const jwt = new SignJWT(claims)
    .setProtectedHeader({ alg: "RS256", kid })
    .setSubject((claims.sub as string) ?? "acct_1")
    .setIssuedAt()
    .setAudience(opts.aud ?? AUD)
    .setIssuer(opts.iss ?? ISS)
    .setExpirationTime(opts.expiresIn ?? "1h");
  return jwt.sign(opts.key ?? priv);
}

describe("extractBearer", () => {
  test("pulls the token after the scheme, case-insensitively", () => {
    expect(extractBearer("Bearer abc.def.ghi")).toBe("abc.def.ghi");
    expect(extractBearer("bearer   xyz")).toBe("xyz");
  });
  test("returns null for missing / malformed headers", () => {
    expect(extractBearer(undefined)).toBeNull();
    expect(extractBearer("")).toBeNull();
    expect(extractBearer("Token abc")).toBeNull();
  });
});

describe("createVerifier", () => {
  const verifier = () => createVerifier({ keys: jwks, audience: AUD, issuer: ISS });

  test("verifies a valid token and extracts the Sunday claims", async () => {
    // app_grants is the per-church map the SundayPlan token hook stamps.
    const token = await sign({
      sub: "acct_42",
      church_ids: ["ch_1", "ch_2"],
      app_grants: { ch_1: ["stage", "song"], ch_2: ["plan"] },
    });
    const claims = await verifier()(token);
    expect(claims.sub).toBe("acct_42");
    expect(claims.church_ids).toEqual(["ch_1", "ch_2"]);
    expect(claims.app_grants).toEqual({ ch_1: ["stage", "song"], ch_2: ["plan"] });
    expect(claims.raw.aud).toBe(AUD);
  });

  test("coerces absent / scalar church_ids to array and missing/malformed app_grants to {}", async () => {
    const token = await sign({ sub: "acct_1", church_ids: "ch_solo" }); // no app_grants
    const claims = await verifier()(token);
    expect(claims.church_ids).toEqual(["ch_solo"]);
    expect(claims.app_grants).toEqual({});

    // A flat array (the old wrong shape) is malformed for a map → {}; a non-string
    // app within a church is dropped.
    const token2 = await sign({
      sub: "acct_2",
      app_grants: { ch_1: ["stage", 5], bad: "nope" } as unknown as Record<string, string[]>,
    });
    const claims2 = await verifier()(token2);
    expect(claims2.app_grants).toEqual({ ch_1: ["stage"] });
    const token3 = await sign({ sub: "acct_3", app_grants: ["stage"] as unknown as Record<string, string[]> });
    expect((await verifier()(token3)).app_grants).toEqual({});
  });

  test("rejects an expired token", async () => {
    const token = await sign({ sub: "acct_1" }, { expiresIn: "-1m" });
    await expect(verifier()(token)).rejects.toThrow();
  });

  test("rejects a token signed by the wrong key", async () => {
    const token = await sign({ sub: "acct_1" });
    const wrongVerifier = createVerifier({ keys: wrongJwks, audience: AUD, issuer: ISS });
    await expect(wrongVerifier(token)).rejects.toThrow();
  });

  test("rejects a token for the wrong audience", async () => {
    const token = await sign({ sub: "acct_1" }, { aud: "some-other-app" });
    await expect(verifier()(token)).rejects.toThrow();
  });

  test("rejects a token for the wrong issuer", async () => {
    const token = await sign({ sub: "acct_1" }, { iss: "https://evil.example" });
    await expect(verifier()(token)).rejects.toThrow();
  });

  test("rejects garbage / non-JWT input", async () => {
    await expect(verifier()("not-a-jwt")).rejects.toThrow();
  });
});

/** Build a tiny app wiring requireAuth (+ optional requireChurch) like a real route. */
function app(resolve?: Parameters<typeof requireChurch>[0]) {
  const verify = createVerifier({ keys: jwks, audience: AUD, issuer: ISS });
  const a = new Hono();
  a.use("*", requireAuth(verify));
  if (resolve !== undefined) a.use("*", requireChurch(resolve));
  else a.use("*", requireChurch());
  a.get("/x", (c) => c.json({ sub: getClaims(c)!.sub }));
  return a;
}

const req = (a: Hono, headers: Record<string, string> = {}, path = "/x") =>
  a.request(path, { headers });

describe("requireAuth middleware", () => {
  test("401 when no Authorization header", async () => {
    const res = await req(app());
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: string }).error).toBe("unauthorized");
  });

  test("401 when the token is invalid", async () => {
    const res = await req(app(), { authorization: "Bearer garbage" });
    expect(res.status).toBe(401);
  });

  test("passes through and exposes claims when valid", async () => {
    const token = await sign({ sub: "acct_7", church_ids: ["ch_9"] });
    const res = await req(app((c) => c.req.query("church_id")), { authorization: `Bearer ${token}` }, "/x?church_id=ch_9");
    expect(res.status).toBe(200);
    expect(((await res.json()) as { sub: string }).sub).toBe("acct_7");
  });
});

describe("requireChurch middleware", () => {
  test("403 when the requested church isn't in the token", async () => {
    const token = await sign({ sub: "acct_1", church_ids: ["ch_1"] });
    const res = await req(app((c) => c.req.query("church_id")), { authorization: `Bearer ${token}` }, "/x?church_id=ch_999");
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toBe("forbidden");
  });

  test("200 when the requested church is granted", async () => {
    const token = await sign({ sub: "acct_1", church_ids: ["ch_1", "ch_2"] });
    const res = await req(app((c) => c.req.query("church_id")), { authorization: `Bearer ${token}` }, "/x?church_id=ch_2");
    expect(res.status).toBe(200);
  });

  test("400 when no church_id can be resolved from the request", async () => {
    const token = await sign({ sub: "acct_1", church_ids: ["ch_1"] });
    const res = await req(app((_c) => undefined), { authorization: `Bearer ${token}` });
    expect(res.status).toBe(400);
  });
});
