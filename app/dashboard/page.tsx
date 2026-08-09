import Link from "next/link";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireStoreStatus } from "@/lib/tenant/access-control";
import { getDashboardSummary } from "@/lib/dashboard/service";
import { getPaymentSettings } from "@/lib/payments/settings-service";
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
  const { store } = await requireStoreStatus(supabase, "active", storeSlug);

  const [summary, paymentSettings] = await Promise.all([
    getDashboardSummary(supabase, store.id),
    getPaymentSettings(supabase, store.id),
  ]);

  const pixReady = paymentSettings.isConfigured && paymentSettings.isEnabled;
  const needsAttention = summary.pendingPixCount > 0 || !pixReady || summary.lowStockProducts.length > 0;

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
                {!pixReady && (
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
                      <Button variant="outline" icon={<IconArrowRight />} iconPosition="end">
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
            <div className={styles.paymentStatus}>
              <span className={styles.paymentIcon} data-ready={pixReady || undefined}>
                {pixReady ? <IconCheck /> : <IconPix />}
              </span>
              <span>
                <strong>{pixReady ? "Pronto para receber" : "Configuração pendente"}</strong>
                <span className={styles.paymentSub}>
                  {paymentSettings.isConfigured
                    ? paymentSettings.isEnabled
                      ? "Pix ativo para esta loja"
                      : "Credenciais salvas, Pix desativado"
                    : "Nenhuma credencial cadastrada"}
                </span>
              </span>
            </div>
            <Link href={`/dashboard/settings/payments?store=${store.slug}`} className={styles.cardFooterLink}>
              {pixReady ? "Ver configuração" : "Configurar agora"}
            </Link>
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
              <Link href={`/dashboard/settings/payments?store=${store.slug}`} className={styles.quickLink}>
                <IconCreditCard />
                Pagamentos
              </Link>
            </div>
          </Card>
        </div>
      </div>
    </DashboardShell>
  );
}
