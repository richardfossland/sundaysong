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
  type AfterCandidate,
  type AfterPick,
  type RankAfterResult,
  applyKeyFlow,
  rankAfter,
} from "./keyFlow";
export {
  type ArcShape,
  type ArcOptions,
  arcCurve,
  applyArc,
} from "./arc";
export {
  type SetCandidate,
  type ComposeRequest,
  type ComposeConstraints,
  type ComposeWeights,
  type ComposedSlot,
  type ComposeTrajectory,
  type ComposeResult,
  DEFAULT_CONSTRAINTS,
  DEFAULT_WEIGHTS,
  composeSet,
} from "./setComposer";
export {
  type RerankResponse,
  RERANK_SYSTEM_PROMPT,
  buildRerankPrompt,
  parseRerankResponse,
  applyRerank,
  rerankPicks,
} from "./rerank";
export {
  type SeasonDefinition,
  type SeasonCandidate,
  type SeasonPick,
  type RankSeasonResult,
  SEASON_DEFINITIONS,
  rankSeason,
  buildSeasonSummary,
} from "./season";
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
