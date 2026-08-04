import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

/**
 * Cookie HttpOnly, path=/reset-password, que carrega o nonce bruto de
 * recuperação — devolvido por app/auth/recovery/route.ts logo depois de
 * `issue_password_recovery_grant` ter sucesso, lido de volta por
 * app/(auth)/reset-password/actions.ts na hora de reivindicar o grant.
 * Só o HASH deste valor é gravado no banco (nonce_hash em
 * public.password_recovery_grants) — o valor bruto nunca é persistido.
 */
export const RECOVERY_NONCE_COOKIE = "sb-recovery-nonce";

/** Janela de validade do grant de recuperação — mesmo valor usado como
 * `maxAge` do cookie de nonce e como `p_ttl_seconds` na emissão. */
export const RECOVERY_GRANT_TTL_SECONDS = 60 * 30;

/**
 * True quando a sessão ATUAL tem um grant de recuperação de senha
 * ativo (emitido, ainda não reivindicado para a troca de senha, não
 * expirado) — checagem inteira delegada a
 * `public.is_current_session_recovery_grant()` (SECURITY DEFINER,
 * zero parâmetros, lê só `auth.uid()`/`auth.jwt()` da própria sessão).
 *
 * Desde a terceira correção pós-QA
 * (qa/reports/TASK-002-CLAUDE-VERIFICATION.md, BUG-CLAUDE-001), o grant
 * lido aqui só pode ter sido criado por
 * `issue_password_recovery_grant` — chamável SOMENTE por `service_role`
 * (nenhum GRANT de tabela nem de RPC de emissão para
 * `anon`/`authenticated`), invocada exclusivamente por
 * app/auth/recovery/route.ts depois de uma verificação REAL de token de
 * recuperação (`supabase.auth.verifyOtp({type:"recovery"})`). Uma
 * sessão comum não tem mais como se autoconceder isto chamando uma RPC
 * diretamente.
 */
export async function isCurrentSessionRecovery(
  supabase: SupabaseClient<Database>,
): Promise<boolean> {
  const { data, error } = await supabase.rpc("is_current_session_recovery_grant");
  if (error) return false;
  return data === true;
}

/**
 * Reivindica atomicamente o grant de recuperação da sessão atual para a
 * troca de senha — deve ser chamada IMEDIATAMENTE ANTES de
 * `supabase.auth.updateUser({ password })`, nunca depois. Exige o nonce
 * bruto (lido do cookie `RECOVERY_NONCE_COOKIE` por
 * app/(auth)/reset-password/actions.ts) além de `auth.uid()`/`session_id`
 * — sem o cookie certo, mesmo uma sessão com um grant pendente de
 * verdade não reivindica nada.
 *
 * `false` significa que não há nada a reivindicar (nonce ausente ou
 * incorreto, sem sessão de recuperação válida, ou já reivindicado por
 * outra requisição concorrente com o mesmo access/refresh token —
 * BUG-RT2-002, qa/reports/TASK-002-RETEST.md): a Server Action deve
 * recusar a troca sem chamar `updateUser()`. O DELETE atômico dentro da
 * função é o que garante que, sob duas tentativas concorrentes,
 * exatamente uma autorização seja bem-sucedida.
 */
export async function claimRecoveryGrantForPasswordChange(
  supabase: SupabaseClient<Database>,
  nonce: string | undefined,
): Promise<boolean> {
  if (!nonce) return false;
  const { data, error } = await supabase.rpc("claim_recovery_grant_for_password_change", {
    p_nonce: nonce,
  });
  if (error) return false;
  return data === true;
}
