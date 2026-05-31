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
export {
  type RecommendRequest,
  type Candidate,
  type RankedPick,
  type RankResult,
  scoreCandidate,
  rankPicks,
} from "./recommend";
export {
  type LlmMessage,
  type LlmCompleteOptions,
  type LlmClient,
  type ClaudeModel,
  CLAUDE_MODELS,
  DEFAULT_LLM_MODEL,
  estimateCost,
  approxTokens,
  AnthropicClient,
  getLlmClient,
} from "./llm";
export {
  type KeyFlowOptions,
  applyKeyFlow,
} from "./keyFlow";
export {
  type RerankResponse,
  RERANK_SYSTEM_PROMPT,
  buildRerankPrompt,
  parseRerankResponse,
  applyRerank,
  rerankPicks,
} from "./rerank";
export {
  type LineMetric,
  type SingabilityReport,
  type TranslatableContext,
  type DraftTranslationRequest,
  type TranslationDraft,
  TRANSLATION_SYSTEM_PROMPT,
  TRANSLATION_DISCLAIMER,
  TranslationRefused,
  syllableCount,
  lyricLines,
  assessSingability,
  canTranslate,
  isTranslatableQuality,
  buildTranslationPrompt,
  parseTranslationResponse,
  draftTranslation,
} from "./translate";
