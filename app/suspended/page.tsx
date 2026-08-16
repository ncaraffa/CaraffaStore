import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireStoreStatus } from "@/lib/tenant/access-control";
import { getCurrentPlatformBillingCharge, mapBillingChargeRowToResult } from "@/lib/billing/orchestration";
import { reconcileBillingChargeById } from "@/lib/billing/reconcile";
import { getPlatformPlan } from "@/lib/billing/plans";
import type { PlanCode } from "@/lib/supabase/types";
import { LogoutButton } from "@/app/logout/logout-button";
import { StatusPage } from "@/components/onboarding/StatusPage";
import { IconAlertTriangle } from "@/components/ui/icons";
import { Alert } from "@/components/ui/Alert";
import { BillingForm } from "@/app/pending-payment/billing-form";
import { BillingStatusClient } from "@/app/pending-payment/billing-status-client";
import pendingPaymentStyles from "@/app/pending-payment/pending-payment.module.css";

export const dynamic = "force-dynamic";

const RECONCILE_ON_STATUSES = new Set(["creating", "pending"]);

/**
 * `suspended` tem duas origens completamente diferentes, distinguidas por
 * stores.suspension_reason (supabase/migrations/0010_billing_overdue_suspension.sql):
 *
 * - `billing_overdue` — billing_suspend_overdue_stores() (cron diário)
 *   suspendeu por mensalidade vencida há mais de 7 dias. Reversível pelo
 *   PRÓPRIO lojista: esta tela mostra o mesmo fluxo de Pix de
 *   /pending-payment (BillingForm/BillingStatusClient, reaproveitados
 *   literalmente) — pagar aprova a cobrança e billing_charge_apply_
 *   provider_state reativa a loja sozinho, sem ação nenhuma aqui além de
 *   requireStoreStatus já ter confirmado que a sessão é de um membro real.
 * - `platform_admin` (ou legado sem motivo gravado) — suspensão manual
 *   pelo painel do dono da plataforma (0009_platform_admin.sql). Nunca
 *   reversível por pagamento nem por qualquer ação do lojista aqui —
 *   mantém a mensagem puramente informativa de antes.
 *
 * requireStoreStatus exige uma loja `suspended` de verdade — uma loja
 * `pending_payment`/`active` não acessa esta página por URL direta
 * (corrige BUG-T2-001, qa/reports/TASK-002.md).
 */
export default async function SuspendedPage({
  searchParams,
}: {
  searchParams: Promise<{ store?: string }>;
}) {
  const { store: storeSlug } = await searchParams;
  const supabase = await createServerSupabaseClient();
  const { store } = await requireStoreStatus(supabase, "suspended", storeSlug);

  const { data: suspensionRow } = await supabase
    .from("stores")
    .select("suspension_reason")
    .eq("id", store.id)
    .maybeSingle();

  if (suspensionRow?.suspension_reason === "billing_overdue") {
    return <BillingOverdueSuspension storeId={store.id} storeSlug={store.slug} supabase={supabase} />;
  }

  return (
    <StatusPage icon={<IconAlertTriangle />} title="Loja suspensa" tone="danger" actions={<LogoutButton />}>
      <p>
        A loja &quot;{store.name}&quot; está suspensa. Nenhuma operação comercial está disponível enquanto este
        estado persistir.
      </p>
    </StatusPage>
  );
}

async function BillingOverdueSuspension({
  storeId,
  storeSlug,
  supabase,
}: {
  storeId: string;
  storeSlug: string;
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>;
}) {
  const { data: planRow } = await supabase
    .from("store_plans")
    .select("plan_code")
    .eq("store_id", storeId)
    .maybeSingle();
  const plan = planRow ? getPlatformPlan(planRow.plan_code as PlanCode) : null;

  let charge = await getCurrentPlatformBillingCharge(supabase, storeId);
  if (charge && RECONCILE_ON_STATUSES.has(charge.status)) {
    const outcome = await reconcileBillingChargeById(charge.id);
    if (outcome.charge) charge = mapBillingChargeRowToResult(outcome.charge);
  }

  const isStuckCreating = charge?.status === "creating";
  const canRetry =
    !charge ||
    isStuckCreating ||
    (charge.status !== "pending" && charge.status !== "approved" && charge.status !== "manual_review");

  return (
    <main className={pendingPaymentStyles.main}>
      <div className={pendingPaymentStyles.header}>
        <h1 className={pendingPaymentStyles.title}>Loja bloqueada por atraso</h1>
        <p className={pendingPaymentStyles.subtitle}>
          A mensalidade está vencida há mais de 7 dias e a loja foi bloqueada automaticamente. Pague por Pix e o
          painel é liberado de novo assim que o pagamento for aprovado — exatamente como estava antes.
        </p>
        {plan && (
          <p className={pendingPaymentStyles.planLine}>
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
            <div className={pendingPaymentStyles.alertGap}>
              <Alert tone="warning">
                A geração da cobrança anterior não terminou (o Mercado Pago não respondeu a tempo). Preencha os dados
                novamente para tentar de novo — nenhuma cobrança duplicada será criada.
              </Alert>
            </div>
          )}
          <BillingForm storeSlug={storeSlug} />
        </>
      )}

      <div className={pendingPaymentStyles.footerActions}>
        <LogoutButton />
      </div>
    </main>
  );
}
