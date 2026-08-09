import Link from "next/link";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireStoreStatus } from "@/lib/tenant/access-control";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import * as orders from "@/lib/orders/service";
import { listOrderPaymentsForStore } from "@/lib/payments/order-payments-service";
import { ORDER_STATUS_LABEL, ORDER_STATUS_TONE } from "@/lib/orders/messages";
import { formatPriceCents } from "@/lib/catalog/format";
import type { Database } from "@/lib/supabase/types";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Table } from "@/components/ui/Table";
import { EmptyState } from "@/components/ui/EmptyState";
import { IconReceipt } from "@/components/ui/icons";
import pageStyles from "../dashboard-list.module.css";
import filterStyles from "../filter-pills.module.css";

export const dynamic = "force-dynamic";

type OrderPaymentRow = Database["public"]["Tables"]["order_payments"]["Row"];
type PaymentFilter = "awaiting" | "paid" | "error" | "expired_cancelled";

const PAYMENT_BADGE: Record<string, { label: string; tone: BadgeTone }> = {
  creating: { label: "Gerando cobrança", tone: "warning" },
  pending: { label: "Aguardando pagamento", tone: "warning" },
  approved: { label: "Pago", tone: "success" },
  rejected: { label: "Recusado", tone: "danger" },
  cancelled: { label: "Cancelado", tone: "neutral" },
  expired: { label: "Expirado", tone: "neutral" },
  error: { label: "Erro", tone: "danger" },
  manual_review: { label: "Em revisão", tone: "danger" },
};

function matchesFilter(payment: OrderPaymentRow | undefined, filter: PaymentFilter | undefined): boolean {
  if (!filter) return true;
  if (!payment) return false;
  if (filter === "awaiting") return payment.status === "creating" || payment.status === "pending";
  if (filter === "paid") return payment.status === "approved";
  if (filter === "error") return payment.status === "error" || payment.status === "manual_review";
  if (filter === "expired_cancelled") {
    return payment.status === "expired" || payment.status === "cancelled" || payment.status === "rejected";
  }
  return true;
}

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ store?: string; payment?: string }>;
}) {
  const { store: storeSlug, payment: paymentFilterRaw } = await searchParams;
  const paymentFilter = (["awaiting", "paid", "error", "expired_cancelled"] as const).includes(
    paymentFilterRaw as PaymentFilter,
  )
    ? (paymentFilterRaw as PaymentFilter)
    : undefined;

  const supabase = await createServerSupabaseClient();
  const { store } = await requireStoreStatus(supabase, "active", storeSlug);

  const [list, payments] = await Promise.all([
    orders.listOrders(supabase, store.id),
    listOrderPaymentsForStore(supabase, store.id),
  ]);
  const paymentByOrderId = new Map(payments.map((p) => [p.order_id, p]));
  const filtered = list.filter((order) => matchesFilter(paymentByOrderId.get(order.id), paymentFilter));

  const filters: Array<{ label: string; value?: PaymentFilter }> = [
    { label: "Todos" },
    { label: "Aguardando pagamento", value: "awaiting" },
    { label: "Pago", value: "paid" },
    { label: "Erro", value: "error" },
    { label: "Expirado/cancelado", value: "expired_cancelled" },
  ];

  return (
    <DashboardShell
      storeName={store.name}
      storeSlug={store.slug}
      storeStatus={store.status}
      active="pedidos"
      breadcrumbs={[{ label: "Painel", href: `/dashboard?store=${store.slug}` }, { label: "Pedidos" }]}
    >
      <div className={pageStyles.header}>
        <div>
          <h1 className={pageStyles.title}>Pedidos</h1>
          <p className={pageStyles.subtitle}>Acompanhe vendas, pagamentos e status de preparo.</p>
        </div>
      </div>

      <nav aria-label="Filtro de pagamento" className={filterStyles.pills}>
        {filters.map((filter) => {
          const isActive = filter.value === paymentFilter;
          const href = filter.value
            ? `/dashboard/orders?store=${store.slug}&payment=${filter.value}`
            : `/dashboard/orders?store=${store.slug}`;
          return (
            <Link key={filter.label} href={href} className={filterStyles.pill} data-active={isActive || undefined}>
              {filter.label}
            </Link>
          );
        })}
      </nav>

      {filtered.length === 0 ? (
        <EmptyState icon={<IconReceipt />} title="Nenhum pedido encontrado" description="Pedidos feitos no seu catálogo público aparecem aqui." />
      ) : (
        <Table>
          <thead>
            <tr>
              <th>Código</th>
              <th>Cliente</th>
              <th>Telefone</th>
              <th>Data</th>
              <th>Modalidade</th>
              <th>Total</th>
              <th>Status</th>
              <th>Pagamento</th>
              <th>Ações</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((order) => {
              const payment = paymentByOrderId.get(order.id);
              const badge = payment ? PAYMENT_BADGE[payment.status] : undefined;
              return (
                <tr key={order.id}>
                  <td>
                    <strong>{order.public_code}</strong>
                  </td>
                  <td>{order.customer_name}</td>
                  <td>{order.customer_phone}</td>
                  <td>{new Date(order.created_at).toLocaleString("pt-BR")}</td>
                  <td>{order.fulfillment_method === "pickup" ? "Retirada" : "Entrega"}</td>
                  <td>{formatPriceCents(order.total_cents)}</td>
                  <td>
                    <Badge tone={ORDER_STATUS_TONE[order.status]}>{ORDER_STATUS_LABEL[order.status]}</Badge>
                  </td>
                  <td>{badge ? <Badge tone={badge.tone}>{badge.label}</Badge> : "—"}</td>
                  <td>
                    <Link href={`/dashboard/orders/${order.id}?store=${store.slug}`}>
                      <Button variant="ghost" size="sm">
                        Abrir
                      </Button>
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </DashboardShell>
  );
}
