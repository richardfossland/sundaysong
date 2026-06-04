/**
 * Shared Nordic-aware text folding + tokenization.
 *
 * This is the single source of truth for how SundaySong normalizes text for
 * matching. It lives in @sundaysong/shared so that BOTH search ranking and the
 * translation-candidate matcher fold identically — the product's #1 promise is
 * "best worship song search for Nordic languages", and that promise breaks the
 * moment two code paths disagree on whether "Når mitt øye" and "Naar mitt oeie"
 * are the same tokens.
 *
 * Folding rules:
 *   - NFD-decompose and drop combining diacritics (é→e, ü→u, ä→a, ö→o);
 *   - lowercase;
 *   - transliterate the special letters people type without the right keyboard:
 *     ø→o, æ→ae, å→a, ß→ss.
 * Zero dependencies; deterministic; offline.
 */

/**
 * Fold a string for comparison: lowercase, strip combining accents, and apply
 * the Nordic letter transliterations people type when they lack the keys.
 */
export function foldNordic(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // drop combining diacritics (é→e, ü→u)
    .toLowerCase()
    .replace(/ø/g, "o")
    .replace(/æ/g, "ae")
    .replace(/å/g, "a")
    .replace(/ß/g, "ss");
}

/** Split a folded string into word tokens (letters + digits). */
export function tokenize(s: string): string[] {
  return foldNordic(s)
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}
