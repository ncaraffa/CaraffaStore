import { notFound } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireStoreStatus } from "@/lib/tenant/access-control";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import * as orders from "@/lib/orders/service";
import { getOrderPayment, listPaymentEvents } from "@/lib/payments/order-payments-service";
import { formatPriceCents } from "@/lib/catalog/format";
import { advanceOrderStatusAction, reconcileOrderPaymentAction } from "../actions";
import { CancelOrderForm } from "./cancel-order-form";
import type { OrderStatus } from "@/lib/supabase/types";
import { Card, CardHeader } from "@/components/ui/Card";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { Table } from "@/components/ui/Table";
import styles from "./order-detail.module.css";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<OrderStatus, string> = {
  pending: "Pendente",
  confirmed: "Confirmado",
  preparing: "Em preparo",
  ready: "Pronto",
  completed: "Concluído",
  cancelled: "Cancelado",
};

const STATUS_TONE: Record<OrderStatus, BadgeTone> = {
  pending: "warning",
  confirmed: "info",
  preparing: "info",
  ready: "info",
  completed: "success",
  cancelled: "neutral",
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

const PAYMENT_STATUS_TONE: Record<string, BadgeTone> = {
  creating: "warning",
  pending: "warning",
  approved: "success",
  rejected: "danger",
  cancelled: "neutral",
  expired: "neutral",
  error: "danger",
  manual_review: "danger",
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
    <DashboardShell
      storeName={store.name}
      storeSlug={store.slug}
      storeStatus={store.status}
      active="pedidos"
      breadcrumbs={[
        { label: "Painel", href: `/dashboard?store=${store.slug}` },
        { label: "Pedidos", href: `/dashboard/orders?store=${store.slug}` },
        { label: order.public_code },
      ]}
    >
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Pedido {order.public_code}</h1>
          <p className={styles.subtitle}>{new Date(order.created_at).toLocaleString("pt-BR")}</p>
        </div>
        <div className={styles.headerBadges}>
          <Badge tone={STATUS_TONE[order.status]}>{STATUS_LABEL[order.status]}</Badge>
          <Badge tone={isPix ? "info" : "neutral"}>{isPix ? "Pix" : "Manual"}</Badge>
        </div>
      </div>

      <div className={styles.layout}>
        <div className={styles.mainCol}>
          <Card>
            <CardHeader title="Cliente" />
            <dl className={styles.infoGrid}>
              <div>
                <dt>Nome</dt>
                <dd>{order.customer_name}</dd>
              </div>
              <div>
                <dt>Telefone</dt>
                <dd>{order.customer_phone}</dd>
              </div>
              <div>
                <dt>Modalidade</dt>
                <dd>{order.fulfillment_method === "pickup" ? "Retirada" : "Entrega"}</dd>
              </div>
              {order.delivery_address && (
                <div>
                  <dt>Endereço</dt>
                  <dd>{order.delivery_address}</dd>
                </div>
              )}
              {order.customer_notes && (
                <div className={styles.spanAll}>
                  <dt>Observações</dt>
                  <dd>{order.customer_notes}</dd>
                </div>
              )}
            </dl>
          </Card>

          <Card>
            <CardHeader title="Itens do pedido" />
            <Table>
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
                  <td colSpan={3}>
                    <strong>Total</strong>
                  </td>
                  <td>
                    <strong>{formatPriceCents(order.total_cents)}</strong>
                  </td>
                </tr>
              </tfoot>
            </Table>
          </Card>

          <div className={styles.actionsRow}>
            {next && (
              <form action={advanceOrderStatusAction}>
                <input type="hidden" name="storeSlug" value={store.slug} />
                <input type="hidden" name="orderId" value={order.id} />
                <input type="hidden" name="newStatus" value={next.status} />
                <Button type="submit">{next.label}</Button>
              </form>
            )}
            {canCancel && <CancelOrderForm storeSlug={store.slug} orderId={order.id} isPix={isPix} />}
          </div>
          {paymentApproved && order.status !== "completed" && order.status !== "cancelled" && (
            <Alert tone="warning">Pedido pago — cancelamento requer reembolso (fora do escopo desta versão).</Alert>
          )}
        </div>

        {isPix && (
          <div className={styles.sideCol}>
            <Card>
              <CardHeader title="Pagamento Pix" />
              {payment ? (
                <>
                  <dl className={styles.infoGrid}>
                    <div>
                      <dt>Estado</dt>
                      <dd>
                        <Badge tone={PAYMENT_STATUS_TONE[payment.status] ?? "neutral"}>
                          {PAYMENT_STATUS_LABEL[payment.status] ?? payment.status}
                        </Badge>
                      </dd>
                    </div>
                    <div>
                      <dt>ID do pagamento (provedor)</dt>
                      <dd className={styles.mono}>{maskProviderPaymentId(payment.provider_payment_id)}</dd>
                    </div>
                    <div>
                      <dt>Valor</dt>
                      <dd>{formatPriceCents(payment.amount_cents)}</dd>
                    </div>
                    <div>
                      <dt>Criado em</dt>
                      <dd>{new Date(payment.created_at).toLocaleString("pt-BR")}</dd>
                    </div>
                    {payment.approved_at && (
                      <div>
                        <dt>Aprovado em</dt>
                        <dd>{new Date(payment.approved_at).toLocaleString("pt-BR")}</dd>
                      </div>
                    )}
                    {payment.expires_at && (
                      <div>
                        <dt>Expira em</dt>
                        <dd>{new Date(payment.expires_at).toLocaleString("pt-BR")}</dd>
                      </div>
                    )}
                    {payment.provider_status_detail && (
                      <div className={styles.spanAll}>
                        <dt>Detalhe</dt>
                        <dd>{payment.provider_status_detail}</dd>
                      </div>
                    )}
                  </dl>

                  {(payment.status === "pending" || payment.status === "creating") && (
                    <form action={reconcileOrderPaymentAction} className={styles.reconcileForm}>
                      <input type="hidden" name="storeSlug" value={store.slug} />
                      <input type="hidden" name="orderId" value={order.id} />
                      <Button type="submit" variant="outline" size="sm">
                        Reconciliar com o provedor
                      </Button>
                    </form>
                  )}
                </>
              ) : (
                <p className={styles.muted}>Nenhuma tentativa de pagamento registrada.</p>
              )}
            </Card>

            {events.length > 0 && (
              <Card>
                <CardHeader title="Histórico de eventos" />
                <Table>
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
                </Table>
              </Card>
            )}
          </div>
        )}
      </div>
    </DashboardShell>
  );
}
