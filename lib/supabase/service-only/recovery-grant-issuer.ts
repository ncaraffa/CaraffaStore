import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { getPublicSupabaseEnv, getServiceRoleEnv } from "@/lib/supabase/env";

/**
 * Módulo server-only, de propósito único: emitir um grant de
 * recuperação de senha (`public.password_recovery_grants`) logo depois
 * de `supabase.auth.verifyOtp({ type: "recovery", token_hash })` ter
 * sucesso REAL em app/auth/recovery/route.ts — o ÚNICO lugar que deve
 * importar este arquivo.
 *
 * `issue_password_recovery_grant` no banco só concede EXECUTE a
 * `service_role` (supabase/migrations/0003_recovery_session.sql) —
 * nenhuma sessão anon/authenticated consegue chamá-la via PostgREST,
 * mesmo tendo um access_token válido, porque a
 * SUPABASE_SERVICE_ROLE_KEY nunca chega ao navegador
 * (lib/supabase/env.ts:getServiceRoleEnv lança se chamada no cliente).
 *
 * Fecha BUG-CLAUDE-001 (qa/reports/TASK-002-CLAUDE-VERIFICATION.md): a
 * emissão do grant deixa de ser uma RPC chamável por qualquer sessão
 * comum a qualquer momento e passa a só acontecer aqui, com
 * `user_id`/`session_id` vindos diretamente da resposta do GoTrue à
 * verificação real do token — nunca de um parâmetro escolhido pelo
 * cliente.
 *
 * Deliberadamente NÃO reaproveita a fábrica de cliente service-role
 * genérica usada por scripts de seed/manutenção (proibida em código de
 * fluxo de usuário desde BUG-T2-004, qa/reports/TASK-002.md — bypassa
 * RLS em TODAS as tabelas). Este módulo cria seu próprio cliente
 * service-role à parte, usado para UMA ÚNICA chamada RPC estreita — não
 * reintroduz uma superfície service-role genérica nos fluxos de
 * usuário.
 */
export interface IssuePasswordRecoveryGrantParams {
  userId: string;
  sessionId: string;
  nonce: string;
  ttlSeconds: number;
}

export async function issuePasswordRecoveryGrant(params: IssuePasswordRecoveryGrantParams): Promise<void> {
  const { NEXT_PUBLIC_SUPABASE_URL } = getPublicSupabaseEnv();
  const { SUPABASE_SERVICE_ROLE_KEY } = getServiceRoleEnv();

  const client = createClient<Database>(NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  const { error } = await client.rpc("issue_password_recovery_grant", {
    p_user_id: params.userId,
    p_session_id: params.sessionId,
    p_nonce: params.nonce,
    p_ttl_seconds: params.ttlSeconds,
  });

  if (error) {
    throw new Error(`issue_password_recovery_grant falhou: ${error.message}`);
  }
}
