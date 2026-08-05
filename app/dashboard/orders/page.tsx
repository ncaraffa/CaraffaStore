import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireStoreStatus } from "@/lib/tenant/access-control";
import { DashboardNav } from "@/app/dashboard/dashboard-nav";
import * as orders from "@/lib/orders/service";
import { listOrderPaymentsForStore } from "@/lib/payments/order-payments-service";
import { formatPriceCents } from "@/lib/catalog/format";
import type { Database, OrderStatus } from "@/lib/supabase/types";

export const dynamic = "force-dynamic";

type OrderPaymentRow = Database["public"]["Tables"]["order_payments"]["Row"];
type PaymentFilter = "awaiting" | "paid" | "error" | "expired_cancelled";

const STATUS_LABEL: Record<OrderStatus, string> = {
  pending: "Pendente",
  confirmed: "Confirmado",
  preparing: "Em preparo",
  ready: "Pronto",
  completed: "Concluído",
  cancelled: "Cancelado",
};

const STATUS_TONE: Record<OrderStatus, "neutral" | "success" | "warning"> = {
  pending: "warning",
  confirmed: "neutral",
  preparing: "neutral",
  ready: "neutral",
  completed: "success",
  cancelled: "neutral",
};

const PAYMENT_BADGE: Record<string, { label: string; tone: "neutral" | "success" | "warning" | "danger" }> = {
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

  return (
    <main>
      <h1>Pedidos — {store.name}</h1>
      <DashboardNav storeSlug={store.slug} />

      <nav aria-label="Filtro de pagamento" className="table-actions">
        <a href={`/dashboard/orders?store=${store.slug}`}>Todos</a>
        <a href={`/dashboard/orders?store=${store.slug}&payment=awaiting`}>Aguardando pagamento</a>
        <a href={`/dashboard/orders?store=${store.slug}&payment=paid`}>Pago</a>
        <a href={`/dashboard/orders?store=${store.slug}&payment=error`}>Erro</a>
        <a href={`/dashboard/orders?store=${store.slug}&payment=expired_cancelled`}>Expirado/cancelado</a>
      </nav>

      {filtered.length === 0 ? (
        <p>Nenhum pedido encontrado.</p>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
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
                    <td>{order.public_code}</td>
                    <td>{order.customer_name}</td>
                    <td>{order.customer_phone}</td>
                    <td>{new Date(order.created_at).toLocaleString("pt-BR")}</td>
                    <td>{order.fulfillment_method === "pickup" ? "Retirada" : "Entrega"}</td>
                    <td>{formatPriceCents(order.total_cents)}</td>
                    <td>
                      <span className="badge" data-tone={STATUS_TONE[order.status]}>
                        {STATUS_LABEL[order.status]}
                      </span>
                    </td>
                    <td>
                      {badge ? (
                        <span className="badge" data-tone={badge.tone}>
                          {badge.label}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>
                      <a href={`/dashboard/orders/${order.id}?store=${store.slug}`}>Abrir</a>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
