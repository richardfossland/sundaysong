/**
 * Mechanism 1 — resolve explicit Translation links.
 *
 * Translation edges form a graph; all songs reachable from the query song are
 * translations of the same underlying work. We walk that graph (undirected,
 * cycle-safe), then label each reached song: songs joined by a direct edge keep
 * that edge's relationship, songs reached only transitively are "transitive".
 * Results are sorted best-first so the UI can show "Also known as ..." sensibly.
 */

import type { TranslationEdge, TranslationLink, TranslationSongMeta, ResolvedRelationship } from "./types";

const RELATIONSHIP_RANK: Record<ResolvedRelationship, number> = {
  official: 0,
  unofficial: 1,
  adaptation: 2,
  paraphrase: 3,
  transitive: 4,
};

const VERIFIER_RANK: Record<string, number> = { admin: 0, community: 1, ai_with_review: 2 };

interface DirectInfo {
  relationship: ResolvedRelationship;
  verified_by?: TranslationEdge["verified_by"];
}

/**
 * Resolve every translation of `songId`. `songMeta` supplies language/title for
 * each reachable song; songs missing from it are skipped (we can't label them).
 */
export function resolveTranslations(
  songId: string,
  edges: TranslationEdge[],
  songMeta: Record<string, TranslationSongMeta>,
): TranslationLink[] {
  // Adjacency list (undirected). Remember the best direct edge to the query.
  const adj = new Map<string, Set<string>>();
  const add = (a: string, b: string) => {
    if (a === b) return; // ignore self-loops
    if (!adj.has(a)) adj.set(a, new Set());
    adj.get(a)!.add(b);
  };
  for (const e of edges) {
    add(e.source_song_id, e.target_song_id);
    add(e.target_song_id, e.source_song_id);
  }

  // Direct neighbours of the query song, with the strongest edge if several.
  const direct = new Map<string, DirectInfo>();
  for (const e of edges) {
    const other = e.source_song_id === songId ? e.target_song_id
      : e.target_song_id === songId ? e.source_song_id
      : null;
    if (other === null || other === songId) continue;
    const candidate: DirectInfo = { relationship: e.relationship, verified_by: e.verified_by };
    const existing = direct.get(other);
    if (!existing || isBetter(candidate, existing)) direct.set(other, candidate);
  }

  // BFS the whole connected component starting at the query song.
  const reached = new Set<string>([songId]);
  const queue: string[] = [songId];
  while (queue.length > 0) {
    const node = queue.shift()!;
    for (const next of adj.get(node) ?? []) {
      if (!reached.has(next)) {
        reached.add(next);
        queue.push(next);
      }
    }
  }
  reached.delete(songId);

  const links: TranslationLink[] = [];
  for (const id of reached) {
    const meta = songMeta[id];
    if (!meta) continue; // unknown song — can't present it
    const d = direct.get(id);
    links.push({
      song_id: id,
      language: meta.language,
      title: meta.canonical_title,
      relationship: d?.relationship ?? "transitive",
      ...(d?.verified_by ? { verified_by: d.verified_by } : {}),
      direct: d !== undefined,
    });
  }

  links.sort((a, b) =>
    RELATIONSHIP_RANK[a.relationship] - RELATIONSHIP_RANK[b.relationship] ||
    verifierRank(a.verified_by) - verifierRank(b.verified_by) ||
    a.language.localeCompare(b.language) ||
    a.title.localeCompare(b.title),
  );
  return links;
}

function isBetter(a: DirectInfo, b: DirectInfo): boolean {
  const r = RELATIONSHIP_RANK[a.relationship] - RELATIONSHIP_RANK[b.relationship];
  if (r !== 0) return r < 0;
  return verifierRank(a.verified_by) < verifierRank(b.verified_by);
}

function verifierRank(v: string | undefined): number {
  return v ? VERIFIER_RANK[v] ?? 9 : 9;
}
