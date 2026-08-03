/**
 * Base usada para montar URLs absolutas enviadas ao Supabase Auth como
 * `emailRedirectTo`/`redirectTo` (ex.: confirmação de e-mail,
 * recuperação de senha). Precisa bater com `additional_redirect_urls`
 * em supabase/config.toml, senão o GoTrue rejeita o redirect.
 */
export function getSiteUrl(): string {
  return process.env.NEXT_PUBLIC_SITE_URL ?? "http://127.0.0.1:3000";
}

export function absoluteUrl(path: string): string {
  return new URL(path, getSiteUrl()).toString();
}
