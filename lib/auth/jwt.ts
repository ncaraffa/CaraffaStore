/**
 * Leitura NÃO-VERIFICADA de claims de um access token do Supabase Auth —
 * só para uso auxiliar (roteamento/telemetria), nunca como prova de
 * identidade. A verificação criptográfica real do token já aconteceu em
 * `supabase.auth.getUser()`/`exchangeCodeForSession` antes de chamar
 * isto; aqui só decodificamos o payload (base64url) para inspecionar
 * claims que a API de alto nível do supabase-js não expõe diretamente.
 */
function decodeJwtPayload(accessToken: string): Record<string, unknown> | null {
  try {
    const payloadSegment = accessToken.split(".")[1];
    if (!payloadSegment) return null;

    const base64 = payloadSegment.replace(/-/g, "+").replace(/_/g, "/");
    const json = Buffer.from(base64, "base64").toString("utf8");
    const payload: unknown = JSON.parse(json);
    return payload && typeof payload === "object" ? (payload as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * Claim `amr` (Authentication Methods Reference). NÃO USAR para
 * distinguir confirmação de cadastro de recuperação de senha — os dois
 * fluxos produzem `amr = [{"method": "otp", ...}]`, idêntico, confirmado
 * contra o Supabase local real (JWT decodificado e
 * `auth.mfa_amr_claims.authentication_method`). A prova de sessão de
 * recuperação vem de `lib/tenant/recovery-session.ts`
 * (`recovery_grants`, tabela própria), não deste claim.
 */
export function getAuthMethods(accessToken: string): string[] {
  const payload = decodeJwtPayload(accessToken);
  const amr = payload?.amr;
  if (!Array.isArray(amr)) return [];

  return amr
    .map((entry) => (entry && typeof entry === "object" ? (entry as { method?: unknown }).method : undefined))
    .filter((method): method is string => typeof method === "string");
}

/**
 * Claim `session_id` — identifica a sessão atual do GoTrue. Usado por
 * `lib/tenant/recovery-session.ts` para comparar com o `session_id`
 * gravado em `recovery_grants` no momento da troca de código de
 * recuperação: uma sessão diferente (novo login) tem `session_id`
 * diferente e não corresponde a nenhum grant válido.
 */
export function getSessionId(accessToken: string): string | null {
  const payload = decodeJwtPayload(accessToken);
  const sessionId = payload?.session_id;
  return typeof sessionId === "string" ? sessionId : null;
}
