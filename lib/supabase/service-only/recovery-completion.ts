import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { getPublicSupabaseEnv, getServiceRoleEnv } from "@/lib/supabase/env";

/**
 * Módulo server-only, de propósito único: concluir uma tentativa de
 * recuperação de senha (`public.complete_password_recovery_attempt`)
 * DEPOIS de `supabase.auth.updateUser({ password })` ter retornado
 * sucesso real em app/(auth)/reset-password/actions.ts — o ÚNICO lugar
 * que deve importar este arquivo.
 *
 * `import "server-only"` (pacote oficial do Next.js) faz o BUILD inteiro
 * falhar caso este módulo algum dia seja acidentalmente alcançado pelo
 * grafo de imports de um Client Component — mesmo padrão do módulo
 * irmão de emissão do grant (lib/supabase/service-only/).
 *
 * `complete_password_recovery_attempt` no banco só concede EXECUTE a
 * `service_role` (supabase/migrations/0004_account_audit.sql) — nenhuma
 * sessão anon/authenticated consegue chamá-la via PostgREST, mesmo tendo
 * um access_token válido e o `attempt_id`/capability corretos, porque a
 * SUPABASE_SERVICE_ROLE_KEY nunca chega ao navegador
 * (lib/supabase/env.ts:getServiceRoleEnv lança se chamada no cliente).
 * O binding causal com a requisição real vem de o `attempt_id` e a
 * `completionCapability` só existirem em memória do processo Next.js,
 * devolvidos por `claimRecoveryGrantForPasswordChange`
 * (lib/tenant/recovery-session.ts) e nunca enviados ao navegador.
 *
 * Fecha BUG-CLAUDE-VERIF3-001 (qa/reports/TASK-002-CLAUDE-VERIFICATION-3.md):
 * a conclusão deixa de ser uma trigger automática correlacionando por
 * `user_id` e passa a exigir a tentativa exata + capability exata +
 * prova de que a credencial realmente mudou.
 *
 * Deliberadamente NÃO reaproveita a fábrica de cliente service-role
 * genérica usada por scripts de seed/manutenção (proibida em código de
 * fluxo de usuário desde BUG-T2-004, qa/reports/TASK-002.md) — cria seu
 * próprio cliente service-role à parte, usado para UMA ÚNICA chamada RPC
 * estreita.
 */
export interface CompletePasswordRecoveryAttemptParams {
  attemptId: string;
  completionCapability: string;
}

export async function completePasswordRecoveryAttempt(
  params: CompletePasswordRecoveryAttemptParams,
): Promise<boolean> {
  const { NEXT_PUBLIC_SUPABASE_URL } = getPublicSupabaseEnv();
  const { SUPABASE_SERVICE_ROLE_KEY } = getServiceRoleEnv();

  const client = createClient<Database>(NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  const { data, error } = await client.rpc("complete_password_recovery_attempt", {
    p_attempt_id: params.attemptId,
    p_capability: params.completionCapability,
  });

  if (error) {
    return false;
  }

  return data === true;
}
