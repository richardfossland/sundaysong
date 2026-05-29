/**
 * `@sundaysong/ai` — embeddings + AI helpers.
 *
 * Embeddings (Phase 3.2) ship today with a deterministic local embedder so
 * semantic search works without an API key. LLM-backed features (translation
 * drafts 4.2, recommendation orchestration 4.3) layer on the same package
 * behind a configured key.
 */

export {
  EMBEDDING_DIM,
  type Embedder,
  LocalEmbedder,
  tokenize,
  cosine,
  getEmbedder,
} from "./embed";
export { songEmbeddingText } from "./songText";
