import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";

import { TransposeInputSchema } from "@sundaysong/shared";
import {
  transposeChordsToKey,
  transposeChordProToKey,
  transposeKeyName,
  toNashville,
  suggestCapo,
  extractChords,
} from "@sundaysong/music";

export const transposeRoutes = new Hono();

/**
 * POST /v1/transpose
 *
 * The "instant transposition" feature. Pure music theory — no DB needed — so
 * it is fully live ahead of the catalog work. Accepts either a list of chord
 * symbols or a ChordPro blob, a source key, and a target (an explicit key or a
 * signed semitone shift). Optionally returns Nashville numbers and capo tips.
 *
 * Stage and Plan call this to re-key a chart on the fly; sundaysong.com uses
 * it in the in-browser chord viewer.
 */
transposeRoutes.post("/", zValidator("json", TransposeInputSchema), (c) => {
  const body = c.req.valid("json");
  const dialect = body.dialect;

  // Normalize the target to a key string for both chords and chordpro paths.
  let toKey: string;
  try {
    toKey = body.to_key ?? transposeKeyName(body.from_key, body.semitones!, dialect);
  } catch (err) {
    return c.json({ error: "invalid_key", message: (err as Error).message }, 400);
  }

  try {
    if (body.chordpro !== undefined) {
      const { text, semitones } = transposeChordProToKey(body.chordpro, body.from_key, toKey, dialect);
      const sourceChords = extractChords(body.chordpro);
      return c.json({
        from_key: body.from_key,
        to_key: toKey,
        semitones,
        chordpro: text,
        ...(body.nashville ? { nashville: sourceChords.map((ch) => toNashville(ch, body.from_key, dialect)) } : {}),
        ...(body.capo ? { capo: suggestCapo(toKey, dialect) } : {}),
      });
    }

    const result = transposeChordsToKey(body.chords!, body.from_key, toKey, dialect);
    return c.json({
      from_key: result.fromKey,
      to_key: result.toKey,
      semitones: result.semitones,
      chords: result.chords,
      ...(body.nashville ? { nashville: body.chords!.map((ch) => toNashville(ch, body.from_key, dialect)) } : {}),
      ...(body.capo ? { capo: suggestCapo(result.toKey, dialect) } : {}),
    });
  } catch (err) {
    return c.json({ error: "invalid_key", message: (err as Error).message }, 400);
  }
});
