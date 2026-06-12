/**
 * Error reporting seam — twin of sundayplan packages/sdk/src/observability.ts
 * (kept dependency-free per repo; the platform package can absorb both once
 * apps physically import @sunday/* packages).
 *
 * Without `SENTRY_DSN` this is a guaranteed no-op (zero network, zero cost),
 * so dev/test/self-hosted installs need nothing. With a DSN, errors are sent
 * to Sentry's store endpoint with a plain `fetch` — no SDK dependency, which
 * keeps the Cloudflare Worker bundle small and the behavior auditable.
 *
 * Deliberately fire-and-forget: reporting must never break or slow the
 * request that failed. Callers `void reportError(...)`.
 */

export interface ErrorReporterEnv {
  SENTRY_DSN?: string;
  SENTRY_ENVIRONMENT?: string;
  [key: string]: string | undefined;
}

interface ParsedDsn {
  storeUrl: string;
  publicKey: string;
}

/** Parse `https://<key>@<host>/<projectId>` into the store-endpoint parts. */
export function parseDsn(dsn: string): ParsedDsn | null {
  try {
    const u = new URL(dsn);
    const projectId = u.pathname.replace(/^\//, "");
    if (!u.username || !projectId) return null;
    return {
      storeUrl: `${u.protocol}//${u.host}/api/${projectId}/store/`,
      publicKey: u.username,
    };
  } catch {
    return null;
  }
}

/** Build the JSON event Sentry's store endpoint accepts. Pure — unit-tested. */
export function buildErrorEvent(
  error: unknown,
  context: { app: string; environment?: string; extra?: Record<string, unknown> },
): Record<string, unknown> {
  const err = error instanceof Error ? error : new Error(String(error));
  return {
    platform: "javascript",
    level: "error",
    environment: context.environment ?? "production",
    tags: { app: context.app },
    exception: {
      values: [
        {
          type: err.name || "Error",
          value: err.message,
          stacktrace: err.stack ? { frames: stackFrames(err.stack) } : undefined,
        },
      ],
    },
    extra: context.extra,
    timestamp: Date.now() / 1000,
  };
}

function stackFrames(stack: string): { function: string; filename: string; lineno?: number }[] {
  return stack
    .split("\n")
    .slice(1, 21)
    .map((line) => {
      const m = /at (.+?) \(?(.+?):(\d+):\d+\)?$/.exec(line.trim());
      return m
        ? { function: m[1], filename: m[2], lineno: Number(m[3]) }
        : { function: line.trim(), filename: "?" };
    })
    .reverse();
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * Report an error. No-op without a DSN; never throws; never awaited by the
 * hot path. Returns whether a report was attempted (for tests).
 */
export async function reportError(
  error: unknown,
  context: { app: string; extra?: Record<string, unknown> },
  env: ErrorReporterEnv = {},
  fetchImpl: FetchLike = fetch,
): Promise<boolean> {
  const dsn = env.SENTRY_DSN?.trim();
  if (!dsn) return false;
  const parsed = parseDsn(dsn);
  if (!parsed) return false;

  try {
    await fetchImpl(parsed.storeUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Sentry-Auth": `Sentry sentry_version=7, sentry_key=${parsed.publicKey}, sentry_client=sunday-seam/1.0`,
      },
      body: JSON.stringify(
        buildErrorEvent(error, { app: context.app, environment: env.SENTRY_ENVIRONMENT, extra: context.extra }),
      ),
    });
  } catch {
    // Reporting failures are swallowed by design.
  }
  return true;
}
