import { TestConnector, SalmebokConnector, type Connector } from "@sundaysong/connectors";

/**
 * Connector registry. Adding a source = one entry here (plus the connector
 * itself). `salmebok` is a real public-domain source; `test` exercises the
 * pipeline. Hymnary (API) + user uploads are the remaining Phase 2.2 sources.
 */
export const connectors: Record<string, () => Connector> = {
  test: () => new TestConnector(),
  salmebok: () => new SalmebokConnector(),
};

export function getConnector(name: string): Connector {
  const factory = connectors[name];
  if (!factory) {
    throw new Error(`unknown connector "${name}" — known: ${Object.keys(connectors).join(", ")}`);
  }
  return factory();
}
