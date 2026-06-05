import type { Context, Next } from "hono";

/**
 * Fixed-window rate limiter (Phase 5.1). Pure core so it's testable without
 * timers; the middleware just feeds it `Date.now()` and the caller key.
 * In-memory + per-process — fine for a single API node / dev; a Redis-backed
 * store slots in behind the same `take()` shape when we scale out.
 */

export interface RateDecision {
  ok: boolean;
  remaining: number;
  /** ms until the window resets (only meaningful when !ok). */
  retryAfterMs: number;
}

interface Window {
  count: number;
  resetAt: number;
}

/** Hard cap on tracked windows. A caller key is cheap to spoof (rotate
 *  X-Forwarded-For / bearer prefix), so the map MUST stay bounded even under a
 *  flood of distinct keys inside one window — otherwise it exhausts memory. */
const MAX_WINDOWS = 10_000;

export class RateLimiter {
  private readonly windows = new Map<string, Window>();
  constructor(private readonly limit: number, private readonly windowMs: number) {}

  take(key: string, now: number): RateDecision {
    let w = this.windows.get(key);
    if (!w || now >= w.resetAt) {
      this.evictIfFull(now);
      w = { count: 0, resetAt: now + this.windowMs };
      this.windows.set(key, w);
    }
    if (w.count >= this.limit) {
      return { ok: false, remaining: 0, retryAfterMs: w.resetAt - now };
    }
    w.count += 1;
    return { ok: true, remaining: this.limit - w.count, retryAfterMs: 0 };
  }

  /** Keep the map bounded before inserting a new window. Reclaims expired
   *  windows and, under a same-window flood, drops single-hit windows (the
   *  cheap, likely-spoofed callers) first — so a key with real activity
   *  (count > 1) survives the flood and stays rate-limited. */
  private evictIfFull(now: number): void {
    if (this.windows.size < MAX_WINDOWS) return;
    // Evict down to a target below the cap so this runs rarely, not per-insert.
    const target = MAX_WINDOWS - (MAX_WINDOWS >> 3);
    for (const [k, w] of this.windows) {
      if (now >= w.resetAt || w.count <= 1) {
        this.windows.delete(k);
        if (this.windows.size <= target) return;
      }
    }
    // Pathological: every window has real activity — drop oldest-inserted to
    // stay strictly bounded rather than grow without limit.
    while (this.windows.size >= MAX_WINDOWS) {
      const first = this.windows.keys().next();
      if (first.done) break;
      this.windows.delete(first.value);
    }
  }

  /** Live window count — exposed for memory-safety assertions in tests. */
  size(): number {
    return this.windows.size;
  }
}

/** Caller identity: API key if present, else forwarded IP, else a shared bucket. */
function callerKey(c: Context): string {
  const auth = c.req.header("authorization");
  if (auth) return "key:" + auth.slice(0, 64);
  return "ip:" + (c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? "local");
}

export function rateLimit(opts: { limit: number; windowMs: number }) {
  const limiter = new RateLimiter(opts.limit, opts.windowMs);
  return async (c: Context, next: Next) => {
    const d = limiter.take(callerKey(c), Date.now());
    c.header("X-RateLimit-Limit", String(opts.limit));
    c.header("X-RateLimit-Remaining", String(Math.max(0, d.remaining)));
    if (!d.ok) {
      const retry = Math.ceil(d.retryAfterMs / 1000);
      c.header("Retry-After", String(retry));
      return c.json({ error: "rate_limited", message: `Rate limit exceeded. Retry in ${retry}s.` }, 429);
    }
    await next();
  };
}
