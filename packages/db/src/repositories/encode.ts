/**
 * Bun.SQL encoding quirks, isolated in one place.
 *
 * Bun.SQL serializes a JS array as a CSV string (not a Postgres array literal),
 * so a `text[]` parameter must be passed as a `{"a","b"}` literal string and
 * cast `::text[]`. (jsonb is the opposite — pass the object directly; calling
 * JSON.stringify first double-encodes it into a string scalar.)
 */
export function toPgTextArray(values: string[]): string {
  if (values.length === 0) return "{}";
  const escaped = values.map((v) => '"' + v.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"');
  return "{" + escaped.join(",") + "}";
}

/**
 * pgvector wants its input as a bracketed literal `[0.1,0.2,...]` cast `::vector`.
 * Same Bun.SQL gotcha as text[]: a raw JS array would serialize to a bare CSV.
 */
export function toPgVector(values: number[]): string {
  return "[" + values.join(",") + "]";
}
