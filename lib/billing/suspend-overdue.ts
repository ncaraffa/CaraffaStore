import "server-only";
import { createPaymentsServiceClient } from "@/lib/payments/service-only/client";

export interface SuspendOverdueSummary {
  suspended: number;
  storeIds: string[];
}

/**
 * Chama billing_suspend_overdue_stores() (supabase/migrations/0010_billing_overdue_suspension.sql)
 * — toda a decisão (quais lojas, janela de 7 dias, corrida com renovação
 * concorrente) vive no banco, num único UPDATE atômico; este wrapper só
 * traduz o resultado pro resumo do cron (app/api/cron/billing/suspend-overdue/route.ts).
 * Reativação NÃO tem um cron equivalente — acontece dentro de
 * billing_charge_apply_provider_state, no mesmo instante em que o Pix é
 * aprovado (webhook ou reconciliação), nunca por varredura periódica.
 */
export async function runBillingSuspendOverdueStores(): Promise<SuspendOverdueSummary> {
  const serviceClient = createPaymentsServiceClient();
  const { data, error } = await serviceClient.rpc("billing_suspend_overdue_stores");

  if (error) {
    throw error;
  }

  const rows = data ?? [];
  return { suspended: rows.length, storeIds: rows.map((row) => row.id) };
}
