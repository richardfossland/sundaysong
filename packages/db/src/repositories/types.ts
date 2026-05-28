/**
 * A minimal structural type for "something you can run a tagged-template query
 * against" — satisfied by both a Bun.SQL connection and a transaction handle
 * from `sql.begin`. Repositories take this so they compose inside transactions.
 */
export interface Executor {
  <T = unknown>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T>;
}
