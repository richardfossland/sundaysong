import {
  TestConnector,
  SalmebokConnector,
  HymnaryConnector,
  type Connector,
} from "@sundaysong/connectors";

/**
 * Connector registry. Adding a source = one entry here (plus the connector
 * itself). `salmebok` is a real public-domain source; `test` exercises the
 * pipeline. `hymnary` is wired (pure normalize tested) but its HTTP discover/
 * fetch are NETWORK-UNVERIFIED — see docs/NEEDS-RICHARD.md. User uploads are
 * the remaining Phase 2.2 source.
 */
export const connectors: Record<string, () => Connector> = {
  test: () => new TestConnector(),
  salmebok: () => new SalmebokConnector(),
  hymnary: () => new HymnaryConnector(),
};

export function getConnector(name: string): Connector {
  const factory = connectors[name];
  if (!factory) {
    throw new Error(`unknown connector "${name}" — known: ${Object.keys(connectors).join(", ")}`);
  }
  return factory();
}
