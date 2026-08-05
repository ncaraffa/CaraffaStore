import { notFound } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireStoreStatus } from "@/lib/tenant/access-control";
import { DashboardNav } from "@/app/dashboard/dashboard-nav";
import * as orders from "@/lib/orders/service";
import { getOrderPayment, listPaymentEvents } from "@/lib/payments/order-payments-service";
import { formatPriceCents } from "@/lib/catalog/format";
import { advanceOrderStatusAction, reconcileOrderPaymentAction } from "../actions";
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

const PAYMENT_STATUS_LABEL: Record<string, string> = {
  creating: "Gerando cobrança",
  pending: "Aguardando pagamento",
  approved: "Aprovado",
  rejected: "Recusado",
  cancelled: "Cancelado",
  expired: "Expirado",
  error: "Erro",
  manual_review: "Em revisão manual",
};

const NEXT_STATUS: Partial<Record<OrderStatus, { status: OrderStatus; label: string }>> = {
  pending: { status: "confirmed", label: "Confirmar" },
  confirmed: { status: "preparing", label: "Iniciar preparo" },
  preparing: { status: "ready", label: "Marcar como pronto" },
  ready: { status: "completed", label: "Concluir" },
};

function maskProviderPaymentId(id: string | null): string {
  if (!id) return "—";
  return id.length <= 4 ? "••••" : `••••${id.slice(-4)}`;
}

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
  const isPix = order.payment_mode === "pix";
  const payment = isPix ? await getOrderPayment(supabase, orderId) : null;
  const events = isPix ? await listPaymentEvents(supabase, orderId) : [];

  const paymentApproved = payment?.status === "approved";
  const next = isPix && order.status === "pending" ? undefined : NEXT_STATUS[order.status];
  const canCancel = order.status !== "completed" && order.status !== "cancelled" && !paymentApproved;

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
        <p>
          <strong>Pagamento:</strong> {isPix ? "Pix" : "Manual"}
        </p>
      </section>

      {isPix && (
        <section>
          <h2>Pix</h2>
          {payment ? (
            <div className="order-detail-info">
              <p>
                <strong>Estado:</strong>{" "}
                <span className="badge">{PAYMENT_STATUS_LABEL[payment.status] ?? payment.status}</span>
              </p>
              <p>
                <strong>ID do pagamento (provedor):</strong> {maskProviderPaymentId(payment.provider_payment_id)}
              </p>
              <p>
                <strong>Valor:</strong> {formatPriceCents(payment.amount_cents)}
              </p>
              <p>
                <strong>Criado em:</strong> {new Date(payment.created_at).toLocaleString("pt-BR")}
              </p>
              {payment.approved_at && (
                <p>
                  <strong>Aprovado em:</strong> {new Date(payment.approved_at).toLocaleString("pt-BR")}
                </p>
              )}
              {payment.expires_at && (
                <p>
                  <strong>Expira em:</strong> {new Date(payment.expires_at).toLocaleString("pt-BR")}
                </p>
              )}
              {payment.provider_status_detail && (
                <p>
                  <strong>Detalhe:</strong> {payment.provider_status_detail}
                </p>
              )}
              {(payment.status === "pending" || payment.status === "creating") && (
                <form action={reconcileOrderPaymentAction}>
                  <input type="hidden" name="storeSlug" value={store.slug} />
                  <input type="hidden" name="orderId" value={order.id} />
                  <button type="submit">Reconciliar com o provedor</button>
                </form>
              )}
            </div>
          ) : (
            <p>Nenhuma tentativa de pagamento registrada.</p>
          )}

          {events.length > 0 && (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Evento</th>
                    <th>Status</th>
                    <th>Recebido em</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((event, index) => (
                    <tr key={`${event.action}-${event.receivedAt}-${index}`}>
                      <td>{event.action}</td>
                      <td>{event.processingStatus}</td>
                      <td>{new Date(event.receivedAt).toLocaleString("pt-BR")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

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
        {canCancel && <CancelOrderForm storeSlug={store.slug} orderId={order.id} isPix={isPix} />}
        {paymentApproved && order.status !== "completed" && order.status !== "cancelled" && (
          <p className="form-status" data-tone="warning">
            Pedido pago — cancelamento requer reembolso (fora do escopo desta versão).
          </p>
        )}
      </section>
    </main>
  );
}
