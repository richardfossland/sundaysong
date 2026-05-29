import type { Song } from "@sundaysong/shared";

/**
 * The text we embed for a song. Semantic content first (title, themes,
 * scripture), because that's what "find the song about chains falling off"
 * needs to match — not chord metadata. Lyrics excerpt adds signal when we
 * have rights to it.
 */
export function songEmbeddingText(
  song: Pick<Song, "canonical_title" | "themes" | "bible_refs">,
  extras?: { lyrics_excerpt?: string | null; composers?: string[] },
): string {
  const parts = [
    song.canonical_title,
    song.themes.join(" "),
    song.bible_refs.join(" "),
    extras?.lyrics_excerpt ?? "",
    (extras?.composers ?? []).join(" "),
  ];
  return parts.filter(Boolean).join(" \n ").trim();
}
