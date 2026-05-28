import { TestConnector, type Connector } from "@sundaysong/connectors";

/**
 * Connector registry. Adding a source = one entry here (plus the connector
 * itself). The real ones — Hymnary, Norsk salmebok, user uploads — land in
 * Phase 2.2; `test` exercises the pipeline today.
 */
export const connectors: Record<string, () => Connector> = {
  test: () => new TestConnector(),
};

export function getConnector(name: string): Connector {
  const factory = connectors[name];
  if (!factory) {
    throw new Error(`unknown connector "${name}" — known: ${Object.keys(connectors).join(", ")}`);
  }
  return factory();
}
