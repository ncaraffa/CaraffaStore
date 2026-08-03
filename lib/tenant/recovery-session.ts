import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { getSessionId } from "@/lib/auth/jwt";

/**
 * True quando a sessão ATUAL corresponde a um grant de recuperação
 * válido — gravado só por app/auth/recovery/route.ts ao trocar o código
 * do link de "esqueci minha senha" (nunca por app/auth/confirm/route.ts,
 * que trata só confirmação de cadastro). A ROTA em si classifica o
 * fluxo, nunca um parâmetro de query como `next`/`type`
 * (qa/reports/TASK-002.md, BUG-T2-003).
 *
 * Compara o `session_id` do JWT ATUAL com o gravado em
 * `recovery_grants`: mesmo que o grant continue no banco, uma sessão
 * diferente (novo login normal) tem `session_id` diferente e não bate —
 * `recovery_grants.session_id` é validado no próprio banco contra
 * `auth.jwt()` (DEFAULT + CHECK constraint em
 * supabase/migrations/0003_recovery_session.sql), nunca aceitando um
 * valor forjado pelo cliente.
 *
 * NÃO usa o claim `amr` do GoTrue: confirmado empiricamente contra o
 * Supabase local real que `amr` não distingue recuperação de
 * confirmação de cadastro (os dois produzem `amr=[{"method":"otp"}]`,
 * idêntico) — ver lib/auth/jwt.ts.
 */
export async function isCurrentSessionRecovery(
  supabase: SupabaseClient<Database>,
): Promise<boolean> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return false;

  const currentSessionId = getSessionId(session.access_token);
  if (!currentSessionId) return false;

  const { data, error } = await supabase.from("recovery_grants").select("session_id").maybeSingle();
  if (error || !data) return false;

  return data.session_id === currentSessionId;
}

/**
 * Encerra o grant de recuperação do usuário atual (chamado depois de uma
 * troca de senha bem-sucedida, além do signOut() — dupla garantia de que
 * o contexto especial não continua disponível). Idempotente: não falha
 * se já não houver grant.
 */
export async function consumeRecoveryGrant(supabase: SupabaseClient<Database>): Promise<void> {
  // Sem filtro explícito: RLS (`user_id = auth.uid()`) já restringe a
  // exclusão à própria linha do usuário autenticado, não à tabela toda.
  await supabase.from("recovery_grants").delete().not("user_id", "is", null);
}
