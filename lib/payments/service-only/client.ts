import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { getPublicSupabaseEnv, getServiceRoleEnv } from "@/lib/supabase/env";

/**
 * Cliente service_role dedicado à orquestração de pagamentos (contorna a
 * RLS de propósito — store_payment_settings/order_payments/
 * payment_webhook_events não têm nenhuma policy pública, ver
 * supabase/migrations/0007_payments.sql). Deliberadamente NÃO reaproveita
 * a fábrica administrativa genérica (arquivo "admin", pasta "supabase" —
 * reservada a scripts de seed/manutenção desde BUG-T2-004,
 * qa/reports/TASK-002.md, proibida em código que responde a requisição de
 * usuário) — mesmo padrão do módulo dedicado de conclusão de recuperação
 * de senha (pasta "service-only" dentro de "supabase"): um cliente
 * próprio, usado só pelos módulos em lib/payments/service-only/*, pelo
 * webhook e pela reconciliação, nunca a partir de uma Server Action antes
 * de validar a requisição do usuário.
 */
export function createPaymentsServiceClient() {
  const { NEXT_PUBLIC_SUPABASE_URL } = getPublicSupabaseEnv();
  const { SUPABASE_SERVICE_ROLE_KEY } = getServiceRoleEnv();

  return createClient<Database>(NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
