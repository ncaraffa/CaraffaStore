/**
 * Sugestão client/server-side de slug a partir de um nome — puramente
 * um atalho de UX (pré-preencher o campo). A fonte de verdade da
 * validação é sempre a checagem final contra `^[a-z0-9]+(-[a-z0-9]+)*$`
 * (lib/catalog/schemas.ts) + a constraint idêntica no banco
 * (supabase/migrations/0005_catalog.sql) — este helper nunca é, por si
 * só, o que autoriza um slug a ser salvo.
 */
const COMBINING_DIACRITICS = /[̀-ͯ]/g;

export function slugify(input: string): string {
  return input
    .normalize("NFD")
    .replace(COMBINING_DIACRITICS, "")
    .toLowerCase()
    .trim()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
}
