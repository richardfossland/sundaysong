/**
 * LLM re-ranking of recommendations (Phase 4.3, AI tier).
 *
 * `rankPicks` (recommend.ts) is the heuristic ranker — it always runs and is
 * the free-tier answer. This layer asks an LLM to *re-order* and *re-explain*
 * those same catalog picks for a worship set: it understands sermon flow and
 * energy arc better than the popularity proxy, and writes a pastoral one-liner
 * per song. Critically it is **grounded** — the model may only reorder the song
 * ids we gave it; any id it invents is dropped (same guarantee as the catalog
 * grounding in `rankPicks`, so the AI can never recommend a song the church
 * can't actually license). Everything here is pure except the single
 * `client.complete` call in `rerankPicks`, which is wrapped so any failure
 * falls back to the heuristic result.
 */

import { rankPicks, type RankResult, type RankedPick, type RecommendRequest, type Candidate } from "./recommend";
import type { LlmClient } from "./llm";

export const RERANK_SYSTEM_PROMPT =
  "You are a worship-planning assistant helping a church music leader order a set of songs they already own the rights to. " +
  "You will be given a request (theme, scripture, energy arc) and a list of candidate songs from the church's catalog. " +
  "Choose the best ORDER for these songs as a worship set and write a short, warm, concrete reason for each pick " +
  "(one sentence, no purple prose). You may only use the song ids provided — never invent songs. " +
  "Respond with ONLY a JSON object, no prose before or after.";

/** Build the user message. Pure — given the request + heuristic picks. */
export function buildRerankPrompt(req: RecommendRequest, picks: RankedPick[], candidates: Candidate[]): string {
  const byId = new Map(candidates.map((c) => [c.id, c]));
  const lines = picks.map((p) => {
    const c = byId.get(p.song_id);
    const themes = c?.themes?.length ? ` | themes: ${c.themes.slice(0, 4).join(", ")}` : "";
    const refs = c?.bible_refs?.length ? ` | scripture: ${c.bible_refs.slice(0, 3).join(", ")}` : "";
    return `- id=${p.song_id} | "${p.title}"${themes}${refs}`;
  });

  const ask = [
    "Request:",
    req.theme ? `  theme: ${req.theme}` : null,
    req.scripture ? `  scripture: ${req.scripture}` : null,
    req.description ? `  description: ${req.description}` : null,
    req.arc ? `  energy arc: ${req.arc} (rising/celebration = build up; reflective/lament = wind down)` : null,
    req.language ? `  language: ${req.language}` : null,
    "",
    "Candidate songs (you may reorder and drop, but not add):",
    ...lines,
    "",
    "Return JSON exactly of this shape:",
    '{ "order": ["<id>", ...], "reasons": { "<id>": "<one-sentence reason>" }, "summary": "<one short sentence about the set>" }',
    'Put the ids in the order you would play them. Omit any song that does not fit. Use only ids from the list above.',
  ]
    .filter((x) => x !== null)
    .join("\n");

  return ask;
}

export interface RerankResponse {
  order: string[];
  reasons: Record<string, string>;
  summary?: string;
}

/** Pull the first balanced JSON object out of a model reply (tolerates fences/prose). */
function extractJsonObject(raw: string): string | null {
  const start = raw.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < raw.length; i++) {
    const ch = raw[i]!;
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return raw.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * Parse + ground the model reply against the allowed ids. Unknown ids are
 * dropped from `order` and `reasons`; duplicates collapse to first occurrence.
 * Returns `null` if nothing usable came back (caller keeps the heuristic).
 */
export function parseRerankResponse(raw: string, allowedIds: Iterable<string>): RerankResponse | null {
  const json = extractJsonObject(raw);
  if (!json) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;

  const allow = new Set(allowedIds);
  const obj = parsed as { order?: unknown; reasons?: unknown; summary?: unknown };

  const seen = new Set<string>();
  const order: string[] = [];
  if (Array.isArray(obj.order)) {
    for (const id of obj.order) {
      if (typeof id === "string" && allow.has(id) && !seen.has(id)) {
        seen.add(id);
        order.push(id);
      }
    }
  }

  const reasons: Record<string, string> = {};
  if (obj.reasons && typeof obj.reasons === "object") {
    for (const [id, reason] of Object.entries(obj.reasons as Record<string, unknown>)) {
      if (allow.has(id) && typeof reason === "string" && reason.trim()) {
        reasons[id] = reason.trim();
      }
    }
  }

  if (order.length === 0 && Object.keys(reasons).length === 0) return null;

  const summary = typeof obj.summary === "string" && obj.summary.trim() ? obj.summary.trim() : undefined;
  return { order, reasons, summary };
}

/**
 * Apply a grounded re-rank onto the heuristic result. Pure.
 * - Picks named in `order` lead, in the model's order.
 * - Picks the model omitted keep their heuristic relative order, appended after.
 * - Per-pick reasons are replaced when the model supplied one.
 * - `summary` is replaced when present; result is flagged `reranked: true`.
 */
export function applyRerank(heuristic: RankResult, parsed: RerankResponse): RankResult {
  const byId = new Map(heuristic.picks.map((p) => [p.song_id, p]));
  const ordered: RankedPick[] = [];

  for (const id of parsed.order) {
    const pick = byId.get(id);
    if (pick) {
      ordered.push({ ...pick, reason: parsed.reasons[id] ?? pick.reason });
      byId.delete(id);
    }
  }
  // Anything the model didn't mention keeps original order at the end.
  for (const pick of heuristic.picks) {
    if (byId.has(pick.song_id)) {
      ordered.push({ ...pick, reason: parsed.reasons[pick.song_id] ?? pick.reason });
    }
  }

  return {
    picks: ordered,
    total_minutes_estimate: heuristic.total_minutes_estimate,
    summary: parsed.summary ?? heuristic.summary,
    reranked: true,
  };
}

/**
 * Full recommendation: heuristic rank always, LLM re-rank when a client is
 * given. Any LLM error (or unusable reply) silently returns the heuristic
 * result — the endpoint never fails because the AI is down. Pass `client` as
 * `getLlmClient()`; when it's `null`, this is exactly `rankPicks`.
 */
export async function rerankPicks(
  req: RecommendRequest,
  candidates: Candidate[],
  client: LlmClient | null,
): Promise<RankResult> {
  const heuristic = rankPicks(req, candidates);
  if (!client || heuristic.picks.length === 0) return heuristic;

  try {
    const user = buildRerankPrompt(req, heuristic.picks, candidates);
    const raw = await client.complete([{ role: "user", content: user }], {
      system: RERANK_SYSTEM_PROMPT,
      temperature: 0,
      maxTokens: 1024,
    });
    const parsed = parseRerankResponse(raw, heuristic.picks.map((p) => p.song_id));
    if (!parsed) return heuristic;
    return applyRerank(heuristic, parsed);
  } catch {
    return heuristic;
  }
}
