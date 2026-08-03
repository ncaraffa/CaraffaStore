import { loadEnvConfig } from "@next/env";

export interface LoadLocalEnvResult {
  /** Nomes dos arquivos de ambiente encontrados e carregados, ex.: [".env.local"]. */
  loadedEnvFiles: string[];
}

/**
 * Carrega `.env.local` (e os demais arquivos de ambiente, na mesma
 * precedência usada por `next dev`/`next build`/`next start`) para
 * `process.env`.
 *
 * O runtime do Next.js já faz isso sozinho para o app (rotas, server
 * components etc.) — por isso esta função nunca é chamada por código de
 * request path. Ela existe para scripts standalone que rodam FORA desse
 * runtime (ex.: scripts/seed-local.ts via `tsx`), que não carregam
 * `.env.local` automaticamente.
 *
 * Variáveis já presentes em `process.env` antes da chamada nunca são
 * sobrescritas pelo conteúdo do arquivo — mesma regra do Next.js.
 */
export function loadLocalEnv(dir: string = process.cwd()): LoadLocalEnvResult {
  const { loadedEnvFiles } = loadEnvConfig(dir, true, console, true);
  return { loadedEnvFiles: loadedEnvFiles.map((file) => file.path) };
}
