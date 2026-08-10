import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireStoreStatus } from "@/lib/tenant/access-control";
import { getCurrentPlatformBillingCharge, mapBillingChargeRowToResult } from "@/lib/billing/orchestration";
import { reconcileBillingChargeById } from "@/lib/billing/reconcile";
import { getPlatformPlan } from "@/lib/billing/plans";
import type { PlanCode } from "@/lib/supabase/types";
import { LogoutButton } from "@/app/logout/logout-button";
import { BillingForm } from "./billing-form";
import { BillingStatusClient } from "./billing-status-client";
import styles from "./pending-payment.module.css";

export const dynamic = "force-dynamic";

const NON_TERMINAL_STATUSES = new Set(["creating", "pending"]);

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
  if (charge && NON_TERMINAL_STATUSES.has(charge.status)) {
    const outcome = await reconcileBillingChargeById(charge.id);
    if (outcome.charge) charge = mapBillingChargeRowToResult(outcome.charge);
  }

  const canRetry =
    !charge || (!NON_TERMINAL_STATUSES.has(charge.status) && charge.status !== "approved" && charge.status !== "manual_review");

  return (
    <main className={styles.main}>
      <div className={styles.header}>
        <h1 className={styles.title}>Ative sua loja</h1>
        <p className={styles.subtitle}>
          Cadastro concluído — falta só a assinatura mensal via Pix para o painel ser liberado.
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
        <BillingForm storeSlug={store.slug} />
      )}

      <div className={styles.footerActions}>
        <LogoutButton />
      </div>
    </main>
  );
}
