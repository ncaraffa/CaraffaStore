import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

/**
 * True quando a sessão ATUAL tem um grant de recuperação de senha
 * ativo (consumido, ainda não reivindicado para a troca de senha, não
 * expirado) — checagem inteira delegada a
 * `public.is_current_session_recovery_grant()` (SECURITY DEFINER,
 * zero parâmetros, lê só `auth.uid()`/`auth.jwt()` da própria sessão).
 *
 * Substitui a versão anterior, que fazia um SELECT direto em
 * `public.recovery_grants` (exigia GRANT de tabela para `authenticated`
 * — foi exatamente essa GRANT que permitiu BUG-RT2-001,
 * qa/reports/TASK-002-RETEST.md: qualquer sessão comum inseria a
 * própria linha e "provava" recuperação sozinha). Agora não há NENHUM
 * grant de tabela em `public.auth_flow_grants` para `authenticated` —
 * só a função pode ler/escrever, e só ativa um grant depois de uma
 * troca de código real (`consume_auth_flow_grant`, chamada por
 * app/auth/recovery/route.ts).
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
 * `supabase.auth.updateUser({ password })`, nunca depois. `false`
 * significa que não há nada a reivindicar (sem sessão de recuperação
 * válida, ou já reivindicado por outra requisição concorrente com o
 * mesmo access/refresh token — BUG-RT2-002,
 * qa/reports/TASK-002-RETEST.md): a Server Action deve recusar a troca
 * sem chamar `updateUser()`. O DELETE atômico dentro da função é o que
 * garante que, sob duas tentativas concorrentes, exatamente uma
 * autorização seja bem-sucedida.
 */
export async function claimRecoveryGrantForPasswordChange(
  supabase: SupabaseClient<Database>,
): Promise<boolean> {
  const { data, error } = await supabase.rpc("claim_recovery_grant_for_password_change");
  if (error) return false;
  return data === true;
}
