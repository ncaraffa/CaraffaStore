/**
 * Leitura NÃO-VERIFICADA do claim `amr` (Authentication Methods
 * Reference) de um access token do Supabase Auth — só para decidir uma
 * restrição de rota adicional em proxy.ts (defesa em profundidade), não
 * como prova de identidade. A verificação criptográfica real do token já
 * aconteceu em `supabase.auth.getUser()` antes de chamar isto; aqui só
 * decodificamos o payload (base64url) para inspecionar um claim que a
 * API de alto nível do supabase-js não expõe diretamente.
 */
export function getAuthMethods(accessToken: string): string[] {
  try {
    const payloadSegment = accessToken.split(".")[1];
    if (!payloadSegment) return [];

    const base64 = payloadSegment.replace(/-/g, "+").replace(/_/g, "/");
    const json = Buffer.from(base64, "base64").toString("utf8");
    const payload = JSON.parse(json) as { amr?: Array<{ method?: string }> };

    return (payload.amr ?? [])
      .map((entry) => entry.method)
      .filter((method): method is string => typeof method === "string");
  } catch {
    return [];
  }
}

/**
 * True quando o método de autenticação mais recente da sessão foi um
 * link de recuperação de senha — essa sessão precisa ficar restrita a
 * /reset-password até a senha ser trocada (ver
 * lib/auth/middleware-policy.ts RECOVERY_SESSION_ALLOWED_PATHS).
 */
export function isRecoverySession(accessToken: string): boolean {
  return getAuthMethods(accessToken).includes("recovery");
}
