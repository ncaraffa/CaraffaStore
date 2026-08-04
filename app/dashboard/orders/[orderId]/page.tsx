import { notFound } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireStoreStatus } from "@/lib/tenant/access-control";
import { DashboardNav } from "@/app/dashboard/dashboard-nav";
import * as orders from "@/lib/orders/service";
import { formatPriceCents } from "@/lib/catalog/format";
import { advanceOrderStatusAction } from "../actions";
import { CancelOrderForm } from "./cancel-order-form";
import type { OrderStatus } from "@/lib/supabase/types";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<OrderStatus, string> = {
  pending: "Pendente",
  confirmed: "Confirmado",
  preparing: "Em preparo",
  ready: "Pronto",
  completed: "Concluído",
  cancelled: "Cancelado",
};

const NEXT_STATUS: Partial<Record<OrderStatus, { status: OrderStatus; label: string }>> = {
  pending: { status: "confirmed", label: "Confirmar" },
  confirmed: { status: "preparing", label: "Iniciar preparo" },
  preparing: { status: "ready", label: "Marcar como pronto" },
  ready: { status: "completed", label: "Concluir" },
};

export default async function OrderDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ orderId: string }>;
  searchParams: Promise<{ store?: string }>;
}) {
  const { orderId } = await params;
  const { store: storeSlug } = await searchParams;
  const supabase = await createServerSupabaseClient();
  const { store } = await requireStoreStatus(supabase, "active", storeSlug);

  const order = await orders.getOrderById(supabase, orderId);
  if (!order || order.store_id !== store.id) {
    notFound();
  }
  const items = await orders.listOrderItems(supabase, orderId);

  const next = NEXT_STATUS[order.status];
  const canCancel = order.status !== "completed" && order.status !== "cancelled";

  return (
    <main>
      <p>
        <a href={`/dashboard/orders?store=${store.slug}`}>← Pedidos</a>
      </p>
      <h1>Pedido {order.public_code}</h1>

      <section className="order-detail-info">
        <p>
          <strong>Cliente:</strong> {order.customer_name}
        </p>
        <p>
          <strong>Telefone:</strong> {order.customer_phone}
        </p>
        <p>
          <strong>Modalidade:</strong> {order.fulfillment_method === "pickup" ? "Retirada" : "Entrega"}
        </p>
        {order.delivery_address && (
          <p>
            <strong>Endereço:</strong> {order.delivery_address}
          </p>
        )}
        {order.customer_notes && (
          <p>
            <strong>Observações:</strong> {order.customer_notes}
          </p>
        )}
        <p>
          <strong>Status:</strong> <span className="badge">{STATUS_LABEL[order.status]}</span>
        </p>
      </section>

      <section>
        <h2>Itens</h2>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Produto</th>
                <th>Preço</th>
                <th>Qtd.</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td>{item.product_name_snapshot}</td>
                  <td>{formatPriceCents(item.unit_price_cents)}</td>
                  <td>{item.quantity}</td>
                  <td>{formatPriceCents(item.line_total_cents)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3}>Subtotal</td>
                <td>{formatPriceCents(order.subtotal_cents)}</td>
              </tr>
              <tr>
                <td colSpan={3}>Total</td>
                <td>{formatPriceCents(order.total_cents)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      <section className="table-actions">
        {next && (
          <form action={advanceOrderStatusAction}>
            <input type="hidden" name="storeSlug" value={store.slug} />
            <input type="hidden" name="orderId" value={order.id} />
            <input type="hidden" name="newStatus" value={next.status} />
            <button type="submit">{next.label}</button>
          </form>
        )}
        {canCancel && <CancelOrderForm storeSlug={store.slug} orderId={order.id} />}
      </section>
    </main>
  );
}
