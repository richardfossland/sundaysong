/**
 * Embeddings for semantic search.
 *
 * Phase 3.2 calls for a hosted embedding model. Hosted providers need an API
 * key + network, so the *default* embedder here is a dependency-free,
 * deterministic local one: it hashes tokens into a fixed-width bag-of-words
 * vector and L2-normalizes. That is enough to make semantic search genuinely
 * work offline (songs sharing themes / scripture / words land near each other),
 * and it's fully testable. Swap in a hosted `Embedder` later without touching
 * callers — the DB column is `vector(1024)`, so keep `dim` at 1024.
 */

export const EMBEDDING_DIM = 1024;

export interface Embedder {
  readonly modelVersion: string;
  readonly dim: number;
  embed(texts: string[]): Promise<number[][]>;
}

/** FNV-1a — small, fast, stable across runs (unlike a random hash seed). */
function hash(token: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < token.length; i++) {
    h ^= token.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Lowercase, split on non-letters (keeps æøåäö and other Unicode letters). */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 1);
}

/** Deterministic, offline bag-of-words embedder. */
export class LocalEmbedder implements Embedder {
  readonly modelVersion = "local-hash-v1";
  readonly dim = EMBEDDING_DIM;

  embedOne(text: string): number[] {
    const vec = new Array<number>(this.dim).fill(0);
    const tokens = tokenize(text);
    for (const tok of tokens) {
      // unigram
      vec[hash(tok) % this.dim] += 1;
      // a light positional bigram-ish signal: token + its length bucket,
      // so "grace" and "graceful" don't fully collide.
      vec[hash(tok + "#" + tok.length) % this.dim] += 0.5;
    }
    // L2 normalize so cosine == dot product and lengths don't dominate.
    const norm = Math.sqrt(vec.reduce((s, x) => s + x * x, 0)) || 1;
    return vec.map((x) => x / norm);
  }

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((t) => this.embedOne(t));
  }
}

/** Cosine similarity of two equal-length vectors (assumes normalized inputs ok). */
export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

/**
 * The active embedder. Today: always the local one. When a hosted key is
 * configured this is where a `VoyageEmbedder` / `OpenAIEmbedder` would be
 * returned instead — same interface, same 1024 dims.
 */
export function getEmbedder(): Embedder {
  return new LocalEmbedder();
}
