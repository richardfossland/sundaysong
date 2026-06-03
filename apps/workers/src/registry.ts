import {
  TestConnector,
  SalmebokConnector,
  HymnaryConnector,
  type Connector,
  type RateLimit,
  type RunSyncOptions,
} from "@sundaysong/connectors";

/**
 * Connector registry. Adding a source = one entry here (plus the connector
 * itself). `salmebok` is a real public-domain source; `test` exercises the
 * pipeline. `hymnary` is wired (pure normalize + scripture-JSON parsers tested)
 * but its HTTP discover/fetch are NETWORK-UNVERIFIED — see docs/NEEDS-RICHARD.md.
 * User uploads are the remaining Phase 2.2 source.
 */
export const connectors: Record<string, () => Connector> = {
  test: () => new TestConnector(),
  salmebok: () => new SalmebokConnector(),
  hymnary: () => new HymnaryConnector(),
};

/**
 * Per-source polite rate limits (Phase 2.2). External APIs have quotas and terms
 * of use; one bucket per source keeps us polite without a global lock. Sources
 * absent here run unthrottled (the orchestrator default) — fine for the in-memory
 * `test` and `salmebok` connectors, which touch no external service.
 *
 * `hymnary`: Hymnary.org asks integrators to be gentle. With discover() caching
 * a whole scripture page per request, a real sync makes only ~one HTTP call per
 * reference, so 1 req/s with a small burst is comfortably within courtesy.
 */
export const RATE_LIMITS: Record<string, RateLimit> = {
  hymnary: { ratePerSec: 1, capacity: 3 },
};

/**
 * Orchestrator options for a source: its rate limit (when one is configured),
 * plus a modest concurrency so a single source never opens a flood of sockets.
 */
export function getRunOptions(name: string): RunSyncOptions {
  const rateLimit = RATE_LIMITS[name];
  return {
    ...(rateLimit ? { rateLimit } : {}),
    concurrency: 4,
  };
}

export function getConnector(name: string): Connector {
  const factory = connectors[name];
  if (!factory) {
    throw new Error(`unknown connector "${name}" — known: ${Object.keys(connectors).join(", ")}`);
  }
  return factory();
}
