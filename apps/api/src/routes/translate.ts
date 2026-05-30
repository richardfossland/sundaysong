import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";

import { TranslateInputSchema } from "@sundaysong/shared";
import { draftTranslation, getLlmClient, TranslationRefused } from "@sundaysong/ai";

export const translateRoutes = new Hono();

/**
 * POST /v1/songs/translate  (Sunday Pro — Phase 4.2 Feature 2)
 *
 * Draft a *singable* translation of a song. The caller passes the source lyrics
 * + their copyright context; we enforce the copyright gate (public-domain or
 * the caller's own upload only — we never re-translate licensed content we
 * don't host) and a content-quality gate before spending a model call. The
 * response includes a per-line singability report + confidence so the UI can
 * show "AI draft — review before use". Needs ANTHROPIC_API_KEY; without it the
 * gate returns 422 (this feature genuinely needs the model — no heuristic).
 */
translateRoutes.post("/", zValidator("json", TranslateInputSchema), async (c) => {
  const body = c.req.valid("json");

  try {
    const draft = await draftTranslation(
      {
        source_title: body.source_title,
        source_lyrics: body.source_lyrics,
        source_language: body.source_language,
        target_language: body.target_language,
        style: body.style,
        context: { copyright_status: body.copyright_status, user_uploaded: body.source_is_user_upload },
      },
      getLlmClient(),
    );
    return c.json(draft);
  } catch (err) {
    if (err instanceof TranslationRefused) {
      return c.json({ error: "translation_refused", message: err.message }, 422);
    }
    return c.json({ error: "translation_failed", message: (err as Error).message }, 502);
  }
});
