import "server-only";
import { createPaymentsServiceClient } from "./service-only/client";
import { reconcilePaymentAttemptById } from "./reconcile";

const BATCH_LIMIT = 50;
const STALE_AFTER_SECONDS = 120;

export interface CronReconcileSummary {
  scanned: number;
  reconciled: number;
  stillPending: number;
  failed: number;
}

/**
 * Varre payment_attempts presos em creating/pending há mais de
 * STALE_AFTER_SECONDS e reconcilia cada um (lib/payments/reconcile.ts —
 * mesmo caminho do webhook). Não é a ÚNICA forma de avançar um pagamento
 * (a página pública e o botão "Reconciliar" do painel também chamam a
 * mesma função) — este cron é a rede de segurança para quando nenhum
 * webhook chegou e ninguém reabriu a página. Lote limitado
 * (BATCH_LIMIT) de propósito — nunca varre a tabela inteira de uma vez.
 */
export async function runCronReconciliation(): Promise<CronReconcileSummary> {
  const client = createPaymentsServiceClient();
  const staleBefore = new Date(Date.now() - STALE_AFTER_SECONDS * 1000).toISOString();

  const { data: stale } = await client
    .from("order_payments")
    .select("id")
    .in("status", ["creating", "pending"])
    .lt("updated_at", staleBefore)
    .order("updated_at", { ascending: true })
    .limit(BATCH_LIMIT);

  const summary: CronReconcileSummary = { scanned: stale?.length ?? 0, reconciled: 0, stillPending: 0, failed: 0 };

  for (const row of stale ?? []) {
    const outcome = await reconcilePaymentAttemptById(row.id);
    if (!outcome.ok) {
      summary.failed += 1;
    } else if (outcome.attempt && (outcome.attempt.status === "pending" || outcome.attempt.status === "creating")) {
      summary.stillPending += 1;
    } else {
      summary.reconciled += 1;
    }
  }

  return summary;
}
