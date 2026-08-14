import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireStoreStatus } from "@/lib/tenant/access-control";
import { getCurrentPlatformBillingCharge, mapBillingChargeRowToResult } from "@/lib/billing/orchestration";
import { reconcileBillingChargeById } from "@/lib/billing/reconcile";
import { getPlatformPlan } from "@/lib/billing/plans";
import type { PlanCode } from "@/lib/supabase/types";
import { LogoutButton } from "@/app/logout/logout-button";
import { BillingForm } from "./billing-form";
import { BillingStatusClient } from "./billing-status-client";
import { Alert } from "@/components/ui/Alert";
import styles from "./pending-payment.module.css";

export const dynamic = "force-dynamic";

// `creating` entra aqui só para acionar a reconciliação abaixo (uma
// corrida rara pode ter deixado provider_payment_id gravado um instante
// depois) — a decisão de retry usa `isStuckCreating` isoladamente, não
// este conjunto (ver QA-FINAL-002).
const RECONCILE_ON_STATUSES = new Set(["creating", "pending"]);

/**
 * TASK-007 — substitui a versão puramente informativa da TASK-002: agora
 * gera de verdade a cobrança de assinatura da própria CaraffaStore e
 * mostra o Pix (reaproveitando o padrão visual de payment-status-
 * client.tsx). requireStoreStatus já garante `pending_payment` fresco do
 * banco — assim que a loja virar `active` (aprovação do Pix, via webhook
 * ou reconciliação), o próximo carregamento desta página redireciona
 * para o dashboard sozinho, sem lógica extra aqui.
 */
export default async function PendingPaymentPage({
  searchParams,
}: {
  searchParams: Promise<{ store?: string }>;
}) {
  const { store: storeSlug } = await searchParams;
  const supabase = await createServerSupabaseClient();
  const { store } = await requireStoreStatus(supabase, "pending_payment", storeSlug);

  const { data: planRow } = await supabase
    .from("store_plans")
    .select("plan_code")
    .eq("store_id", store.id)
    .maybeSingle();
  const plan = planRow ? getPlatformPlan(planRow.plan_code as PlanCode) : null;

  let charge = await getCurrentPlatformBillingCharge(supabase, store.id);
  if (charge && RECONCILE_ON_STATUSES.has(charge.status)) {
    const outcome = await reconcileBillingChargeById(charge.id);
    if (outcome.charge) charge = mapBillingChargeRowToResult(outcome.charge);
  }

  // QA-FINAL-002 (achado no QA independente): uma cobrança pode ficar
  // presa em `creating` para sempre se a primeira chamada ao Mercado
  // Pago sofreu erro transitório (timeout/5xx) — billing_charge_
  // upsert_creating/mark_creation_failed deliberadamente NÃO marcam
  // falha definitiva nesse caso (ver lib/billing/orchestration.ts), e
  // reconcileBillingChargeById não tem provider_payment_id pra
  // consultar ainda. Sem isto, o usuário via só "Gerando cobrança..."
  // indefinidamente, sem QR e sem forma de continuar. `isStuckCreating`
  // trata esse caso como "pode tentar de novo": reenviar o formulário
  // chama createPlatformBillingCharge outra vez, que — graças ao fix do
  // QA-FINAL-001 — reaproveita a MESMA cobrança e a MESMA
  // provider_idempotency_key já persistida, nunca duplica nada.
  const isStuckCreating = charge?.status === "creating";
  const canRetry =
    !charge ||
    isStuckCreating ||
    (charge.status !== "pending" && charge.status !== "approved" && charge.status !== "manual_review");

  return (
    <main className={styles.main}>
      <div className={styles.header}>
        <h1 className={styles.title}>Ative sua loja</h1>
        <p className={styles.subtitle}>
          Cadastro concluído. Pague a primeira mensalidade por Pix e o painel é liberado automaticamente, assim que o
          pagamento for aprovado.
        </p>
        {plan && (
          <p className={styles.planLine}>
            Plano <strong>{plan.label}</strong> — R$ {plan.price}/mês
          </p>
        )}
      </div>

      {charge && !canRetry ? (
        <BillingStatusClient
          status={charge.status}
          planLabel={plan?.label ?? `#${charge.planCode}`}
          amountCents={charge.amountCents}
          qrCode={charge.qrCode}
          qrCodeBase64={charge.qrCodeBase64}
          ticketUrl={charge.ticketUrl}
          expiresAt={charge.expiresAt}
        />
      ) : (
        <>
          {isStuckCreating && (
            <div className={styles.alertGap}>
              <Alert tone="warning">
                A geração da cobrança anterior não terminou (o Mercado Pago não respondeu a tempo). Preencha os dados
                novamente para tentar de novo — nenhuma cobrança duplicada será criada.
              </Alert>
            </div>
          )}
          <BillingForm storeSlug={store.slug} />
        </>
      )}

      <div className={styles.footerActions}>
        <LogoutButton />
      </div>
    </main>
  );
}
