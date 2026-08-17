import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireStoreStatus } from "@/lib/tenant/access-control";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { getSubscriptionStatus, OVERDUE_GRACE_DAYS, type SubscriptionStatus } from "@/lib/billing/subscription";
import { getCurrentPlatformBillingCharge, mapBillingChargeRowToResult } from "@/lib/billing/orchestration";
import { reconcileBillingChargeById } from "@/lib/billing/reconcile";
import { getPlatformPlan } from "@/lib/billing/plans";
import { formatPriceCents } from "@/lib/catalog/format";
import { Card } from "@/components/ui/Card";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { BillingStatusClient } from "@/app/pending-payment/billing-status-client";
import { RenewPanel } from "./renew-panel";
import styles from "./subscription.module.css";

export const dynamic = "force-dynamic";

/** Estados em que ainda existe um Pix em voo — a tela mostra o QR em vez do formulário. */
const IN_FLIGHT_STATUSES = new Set(["creating", "pending"]);

function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });
}

/**
 * Texto do prazo em português de gente: "vence hoje" e "venceu ontem" são
 * frases, não "0 dias" / "-1 dias". Só cai na forma numérica quando ela é
 * de fato a mais clara.
 */
function describeRemaining(status: SubscriptionStatus): string {
  const { daysRemaining, isExpired } = status;
  if (daysRemaining === null) return "Sem assinatura ativa";
  if (isExpired) {
    const overdue = Math.abs(daysRemaining);
    if (overdue === 0) return "Venceu hoje";
    if (overdue === 1) return "Venceu ontem";
    return `Venceu há ${overdue} dias`;
  }
  if (daysRemaining === 1) return "Vence amanhã";
  return `Faltam ${daysRemaining} dias`;
}

export default async function SubscriptionPage({ searchParams }: { searchParams: Promise<{ store?: string }> }) {
  const { store: storeSlug } = await searchParams;
  const supabase = await createServerSupabaseClient();
  const { store } = await requireStoreStatus(supabase, "active", storeSlug);

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const subscription = await getSubscriptionStatus(supabase, store.id);

  // Mesma reconciliação sob demanda das outras telas de billing: se houver
  // um Pix em voo, consulta o Mercado Pago de verdade antes de decidir o
  // que exibir — assim que ele é aprovado, esta página já mostra o período
  // novo, sem depender de o webhook ter chegado primeiro.
  let charge = await getCurrentPlatformBillingCharge(supabase, store.id);
  if (charge && IN_FLIGHT_STATUSES.has(charge.status)) {
    const outcome = await reconcileBillingChargeById(charge.id);
    if (outcome.charge) charge = mapBillingChargeRowToResult(outcome.charge);
  }

  // Recarrega o resumo depois da reconciliação: se o Pix acabou de ser
  // aprovado, `subscription` acima foi lido antes disso e mostraria o
  // período antigo — exatamente o "atualiza isso lá na assinatura" pedido.
  const finalSubscription = charge?.status === "approved" ? await getSubscriptionStatus(supabase, store.id) : subscription;

  const hasPixInFlight = Boolean(charge && IN_FLIGHT_STATUSES.has(charge.status));
  const plan = finalSubscription?.currentPlanCode ? getPlatformPlan(finalSubscription.currentPlanCode) : null;
  const pendingPlan = charge && hasPixInFlight ? getPlatformPlan(charge.planCode) : null;
  const isPlanChange = Boolean(
    pendingPlan && finalSubscription?.currentPlanCode && pendingPlan.code !== finalSubscription.currentPlanCode,
  );

  return (
    <DashboardShell
      storeName={store.name}
      storeSlug={store.slug}
      storeStatus={store.status}
      active="assinatura"
      breadcrumbs={[{ label: "Painel", href: `/dashboard?store=${store.slug}` }, { label: "Assinatura" }]}
    >
      <header className={styles.header}>
        <h1 className={styles.title}>Assinatura</h1>
        <p className={styles.subtitle}>
          Seu plano, até quando está pago e a renovação — tudo em um lugar só.
        </p>
      </header>

      {finalSubscription?.isExpiringSoon && (
        <div className={styles.alertGap}>
          <Alert tone="warning" title="Sua assinatura expira em breve">
            {describeRemaining(finalSubscription)} até o vencimento, em {formatDate(finalSubscription.currentPeriodEnd)}.
            Renove para a loja continuar no ar sem interrupção.
          </Alert>
        </div>
      )}

      {finalSubscription?.isExpired && (
        <div className={styles.alertGap}>
          <Alert tone="danger" title="Sua assinatura venceu">
            {describeRemaining(finalSubscription)}. A loja é bloqueada automaticamente {OVERDUE_GRACE_DAYS} dias após o
            vencimento — renove para evitar o bloqueio.
          </Alert>
        </div>
      )}

      <Card className={styles.summaryCard}>
        <div className={styles.summaryHead}>
          <div>
            <span className={styles.summaryLabel}>Plano atual</span>
            {plan ? (
              <p className={styles.planTitle}>
                {plan.label} <span className={styles.planAmount}>R$ {plan.price}/mês</span>
              </p>
            ) : (
              <p className={styles.planTitle}>Nenhum plano ativo</p>
            )}
          </div>
          {finalSubscription && !finalSubscription.isExpired && finalSubscription.daysRemaining !== null && (
            <Badge tone={finalSubscription.isExpiringSoon ? "warning" : "success"}>
              {describeRemaining(finalSubscription)}
            </Badge>
          )}
          {finalSubscription?.isExpired && <Badge tone="danger">{describeRemaining(finalSubscription)}</Badge>}
        </div>

        <dl className={styles.factGrid}>
          <div className={styles.fact}>
            <dt>Assinante desde</dt>
            <dd>{formatDate(finalSubscription?.subscribedAt ?? null)}</dd>
          </div>
          <div className={styles.fact}>
            <dt>Período atual</dt>
            <dd>
              {finalSubscription?.currentPeriodStart
                ? `${formatDate(finalSubscription.currentPeriodStart)} até ${formatDate(finalSubscription.currentPeriodEnd)}`
                : "—"}
            </dd>
          </div>
          <div className={styles.fact}>
            <dt>Próxima renovação</dt>
            <dd>{formatDate(finalSubscription?.currentPeriodEnd ?? null)}</dd>
          </div>
          <div className={styles.fact}>
            <dt>Último pagamento</dt>
            <dd>
              {finalSubscription?.lastApprovedAmountCents
                ? formatPriceCents(finalSubscription.lastApprovedAmountCents)
                : "—"}
            </dd>
          </div>
        </dl>
      </Card>

      {hasPixInFlight && charge ? (
        <section className={styles.pixSection}>
          <h2 className={styles.sectionTitle}>Renovação em andamento</h2>
          <p className={styles.sectionHint}>
            {isPlanChange && pendingPlan
              ? `Você escolheu o plano ${pendingPlan.label}. A troca passa a valer assim que este Pix for aprovado — até lá, seu plano continua o mesmo.`
              : "Pague o Pix abaixo para estender sua assinatura por mais 30 dias."}
          </p>
          <BillingStatusClient
            status={charge.status}
            planLabel={pendingPlan?.label ?? `#${charge.planCode}`}
            amountCents={charge.amountCents}
            qrCode={charge.qrCode}
            qrCodeBase64={charge.qrCodeBase64}
            ticketUrl={charge.ticketUrl}
            expiresAt={charge.expiresAt}
          />
        </section>
      ) : (
        <section className={styles.renewSection}>
          <h2 className={styles.sectionTitle}>Renovar</h2>
          <RenewPanel
            storeSlug={store.slug}
            currentPlanCode={finalSubscription?.currentPlanCode ?? null}
            defaultEmail={user?.email ?? ""}
            defaultOpen={Boolean(finalSubscription?.isExpiringSoon || finalSubscription?.isExpired)}
            ctaLabel={finalSubscription?.isExpired ? "Renovar agora" : "Renovar assinatura"}
          />
        </section>
      )}
    </DashboardShell>
  );
}
