/**
 * Barreira contra execução acidental de scripts destrutivos/dev-only
 * (seed local, fixtures, resets, simulação de webhook) contra um projeto
 * que não seja um Supabase local de desenvolvimento. Usa dois sinais
 * independentes, nenhum baseado só em comentário/documentação:
 *
 * 1. `NODE_ENV=production` — bloqueio incondicional, sem override possível.
 * 2. `NEXT_PUBLIC_SUPABASE_URL` não apontando para um host local
 *    (127.0.0.1/localhost, a URL padrão de `npx supabase start`) — só
 *    prossegue se `SEED_ALLOW_REMOTE_SUPABASE=true` for definida
 *    explicitamente, confirmando que o operador sabe que está apontando
 *    para um projeto remoto (ex.: um Supabase de staging isolado, nunca
 *    produção — produção continua bloqueada pelo item 1 sempre que
 *    `NODE_ENV=production` estiver setado, e adicionalmente pela ausência
 *    de dados reais em qualquer projeto usado para isso).
 */
function isLocalSupabaseHostname(hostname: string): boolean {
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1";
}

export function assertLocalOnlyScript(scriptName: string): void {
  const problems: string[] = [];

  if (process.env.NODE_ENV === "production") {
    problems.push("NODE_ENV=production");
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  let hostname = "";
  try {
    hostname = new URL(supabaseUrl).hostname;
  } catch {
    problems.push("NEXT_PUBLIC_SUPABASE_URL ausente ou inválida");
  }

  if (hostname && !isLocalSupabaseHostname(hostname) && process.env.SEED_ALLOW_REMOTE_SUPABASE !== "true") {
    problems.push(
      "NEXT_PUBLIC_SUPABASE_URL não aponta para um Supabase local (127.0.0.1/localhost) — " +
        "defina SEED_ALLOW_REMOTE_SUPABASE=true explicitamente se isto for intencional " +
        "(nunca aponte para um projeto de produção)",
    );
  }

  if (problems.length > 0) {
    throw new Error(
      `${scriptName}: execução recusada por segurança. Motivo(s): ${problems.join("; ")}.`,
    );
  }
}
