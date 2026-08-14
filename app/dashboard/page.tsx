import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireStoreStatus } from "@/lib/tenant/access-control";
import { getDashboardSummary } from "@/lib/dashboard/service";
import { getPaymentSettings, PaymentSettingsError, type PaymentSettingsView } from "@/lib/payments/settings-service";
import { ORDER_STATUS_LABEL, ORDER_STATUS_TONE } from "@/lib/orders/messages";
import { formatPriceCents } from "@/lib/catalog/format";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { Card, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import {
  IconAlertTriangle,
  IconArrowRight,
  IconBox,
  IconCheck,
  IconCreditCard,
  IconExternalLink,
  IconPix,
  IconReceipt,
  IconTag,
} from "@/components/ui/icons";
import styles from "./dashboard-home.module.css";

export const dynamic = "force-dynamic";

/**
 * Isola a leitura de payment_settings_get: só é chamada quando o membro é
 * owner/admin (única condição em que can_manage_store_payments autoriza),
 * então um erro aqui já não é falta de privilégio esperada — é uma falha
 * real (RPC fora do ar, drift de ambiente). Registra no servidor e
 * degrada só o cartão de Pix em vez de derrubar a dashboard inteira.
 */
async function fetchPaymentSettingsSafely(
  supabase: SupabaseClient<Database>,
  storeId: string,
): Promise<PaymentSettingsView | null> {
  try {
    return await getPaymentSettings(supabase, storeId);
  } catch (error) {
    if (error instanceof PaymentSettingsError) {
      console.error("[dashboard] falha ao carregar payment settings", { storeId, code: error.code });
      return null;
    }
    throw error;
  }
}

/**
 * requireStoreStatus exige uma loja `active` de verdade — sem `?store=`
 * resolve pela situação real de memberships (nunca libera acesso
 * genérico por ausência do parâmetro; corrige BUG-T2-001,
 * qa/reports/TASK-002.md).
 */
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ store?: string }>;
}) {
  const { store: storeSlug } = await searchParams;
  const supabase = await createServerSupabaseClient();
  const { store, role } = await requireStoreStatus(supabase, "active", storeSlug);

  /**
   * payment_settings_get (0007_payments.sql) só autoriza owner/admin
   * (can_manage_store_payments) — staff nunca lê configuração de
   * pagamento, por desenho, porque o retorno é dado sensível de loja.
   * Chamar o RPC para staff sempre lança insufficient_privilege; a
   * dashboard precisa respeitar essa fronteira em vez de tentar a
   * chamada e tratar o erro depois.
   */
  const canManagePayments = role === "owner" || role === "admin";

  const [summary, paymentSettings] = await Promise.all([
    getDashboardSummary(supabase, store.id),
    canManagePayments ? fetchPaymentSettingsSafely(supabase, store.id) : Promise.resolve(null),
  ]);

  const pixReady = paymentSettings ? paymentSettings.isConfigured && paymentSettings.isEnabled : false;
  const pixStatusUnknown = canManagePayments && paymentSettings === null;
  const needsAttention =
    summary.pendingPixCount > 0 || (canManagePayments && !pixReady) || summary.lowStockProducts.length > 0;

  return (
    <DashboardShell storeName={store.name} storeSlug={store.slug} storeStatus={store.status} active="painel">
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Olá! Bem-vindo de volta.</h1>
          <p className={styles.subtitle}>
            A loja <strong>{store.name}</strong> está ativa e pronta para vender.
          </p>
        </div>
        <a href={`/loja/${store.slug}`} target="_blank" rel="noreferrer" className={styles.catalogLink}>
          <IconExternalLink />
          Ver catálogo público
        </a>
      </div>

      {/* Faixa de destaque — três números reais, o de receita pesa mais
          porque é a pergunta que o lojista faz primeiro ao abrir o painel. */}
      <div className={styles.stats}>
        <div className={styles.statPrimary}>
          <span className={styles.statLabel}>Receita confirmada · 30 dias</span>
          <span className={styles.statValue}>{formatPriceCents(summary.revenueLast30dCents)}</span>
          <span className={styles.statCaption}>Pedidos confirmados, em preparo, prontos ou concluídos</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statLabel}>Pedidos · 24h</span>
          <span className={styles.statValueSm}>{summary.ordersLast24h}</span>
        </div>
        <div className={styles.stat} data-attention={summary.pendingPixCount > 0 || undefined}>
          <span className={styles.statLabel}>Aguardando Pix</span>
          <span className={styles.statValueSm}>{summary.pendingPixCount}</span>
        </div>
      </div>

      <div className={styles.grid}>
        <div className={styles.mainCol}>
          {needsAttention && (
            <Card className={styles.attentionCard}>
              <p className={styles.attentionTitle}>
                <IconAlertTriangle />
                Precisa da sua atenção
              </p>
              <ul className={styles.attentionList}>
                {canManagePayments && !pixReady && (
                  <li>
                    <span>Pix ainda não está pronto para receber pagamentos.</span>
                    <Link href={`/dashboard/settings/payments?store=${store.slug}`}>Configurar agora</Link>
                  </li>
                )}
                {summary.pendingPixCount > 0 && (
                  <li>
                    <span>
                      {summary.pendingPixCount === 1
                        ? "1 pedido aguardando pagamento via Pix."
                        : `${summary.pendingPixCount} pedidos aguardando pagamento via Pix.`}
                    </span>
                    <Link href={`/dashboard/orders?store=${store.slug}&payment=awaiting`}>Ver pedidos</Link>
                  </li>
                )}
                {summary.lowStockProducts.length > 0 && (
                  <li>
                    <span>
                      {summary.lowStockProducts.length === 1
                        ? "1 produto publicado com estoque baixo."
                        : `${summary.lowStockProducts.length} produtos publicados com estoque baixo.`}
                    </span>
                    <Link href={`/dashboard/products?store=${store.slug}`}>Ver produtos</Link>
                  </li>
                )}
              </ul>
            </Card>
          )}

          <Card padded={false}>
            <div className={styles.cardHeaderPad}>
              <CardHeader
                title="Pedidos recentes"
                actions={
                  <Link href={`/dashboard/orders?store=${store.slug}`} className={styles.viewAll}>
                    Ver todos
                  </Link>
                }
              />
            </div>

            {summary.hasAnyOrder ? (
              <ul className={styles.activityList}>
                {summary.recentOrders.map((order) => (
                  <li key={order.id}>
                    <Link href={`/dashboard/orders/${order.id}?store=${store.slug}`} className={styles.activityRow}>
                      <span className={styles.activityCode}>#{order.publicCode}</span>
                      <span className={styles.activityCustomer}>{order.customerName}</span>
                      <span className={styles.activityDate}>
                        {new Date(order.createdAt).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}
                      </span>
                      <Badge tone={ORDER_STATUS_TONE[order.status]}>{ORDER_STATUS_LABEL[order.status]}</Badge>
                      <span className={styles.activityValue}>{formatPriceCents(order.totalCents)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <div className={styles.emptyPad}>
                <EmptyState
                  icon={<IconReceipt />}
                  title="Nenhum pedido ainda"
                  description="Assim que alguém comprar no seu catálogo público, o pedido aparece aqui."
                  action={
                    <a href={`/loja/${store.slug}`} target="_blank" rel="noreferrer">
                      <Button as="span" variant="outline" icon={<IconArrowRight />} iconPosition="end">
                        Ver catálogo público
                      </Button>
                    </a>
                  }
                />
              </div>
            )}
          </Card>
        </div>

        <div className={styles.sideCol}>
          <Card>
            <CardHeader title="Produtos" />
            <div className={styles.miniStats}>
              <div>
                <span className={styles.miniStatValue}>{summary.productsPublished}</span>
                <span className={styles.miniStatLabel}>Publicados</span>
              </div>
              <div>
                <span className={styles.miniStatValue}>{summary.productsDraft}</span>
                <span className={styles.miniStatLabel}>Rascunho</span>
              </div>
            </div>
            {summary.lowStockProducts.length > 0 && (
              <ul className={styles.stockList}>
                {summary.lowStockProducts.map((product) => (
                  <li key={product.id}>
                    <span className={styles.stockName}>{product.name}</span>
                    <span className={styles.stockCount} data-low={product.stock === 0 || undefined}>
                      {product.stock === 0 ? "Esgotado" : `${product.stock} un.`}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <Link href={`/dashboard/products?store=${store.slug}`} className={styles.cardFooterLink}>
              Ver todos os produtos
            </Link>
          </Card>

          <Card>
            <CardHeader title="Pix / Mercado Pago" />
            {!canManagePayments ? (
              <div className={styles.paymentStatus}>
                <span className={styles.paymentIcon}>
                  <IconPix />
                </span>
                <span>
                  <strong>Acesso restrito</strong>
                  <span className={styles.paymentSub}>Configuração de pagamento é visível só para proprietários e administradores.</span>
                </span>
              </div>
            ) : pixStatusUnknown ? (
              <div className={styles.paymentStatus}>
                <span className={styles.paymentIcon}>
                  <IconAlertTriangle />
                </span>
                <span>
                  <strong>Não foi possível carregar</strong>
                  <span className={styles.paymentSub}>Tente novamente em instantes ou abra a configuração diretamente.</span>
                </span>
              </div>
            ) : (
              <div className={styles.paymentStatus}>
                <span className={styles.paymentIcon} data-ready={pixReady || undefined}>
                  {pixReady ? <IconCheck /> : <IconPix />}
                </span>
                <span>
                  <strong>{pixReady ? "Pronto para receber" : "Configuração pendente"}</strong>
                  <span className={styles.paymentSub}>
                    {paymentSettings?.isConfigured
                      ? paymentSettings.isEnabled
                        ? "Pix ativo para esta loja"
                        : "Credenciais salvas, Pix desativado"
                      : "Nenhuma credencial cadastrada"}
                  </span>
                </span>
              </div>
            )}
            {canManagePayments && (
              <Link href={`/dashboard/settings/payments?store=${store.slug}`} className={styles.cardFooterLink}>
                {pixReady ? "Ver configuração" : "Configurar agora"}
              </Link>
            )}
          </Card>

          <Card>
            <CardHeader title="Ações rápidas" />
            <div className={styles.quickLinks}>
              <Link href={`/dashboard/products/new?store=${store.slug}`} className={styles.quickLink}>
                <IconBox />
                Novo produto
              </Link>
              <Link href={`/dashboard/categories/new?store=${store.slug}`} className={styles.quickLink}>
                <IconTag />
                Nova categoria
              </Link>
              {canManagePayments && (
                <Link href={`/dashboard/settings/payments?store=${store.slug}`} className={styles.quickLink}>
                  <IconCreditCard />
                  Pagamentos
                </Link>
              )}
            </div>
          </Card>
        </div>
      </div>
    </DashboardShell>
  );
}
