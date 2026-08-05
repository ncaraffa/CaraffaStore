import "server-only";
import { createPaymentsServiceClient } from "./service-only/client";
import { getStorePaymentCredentials } from "./service-only/credentials-reader";
import { getPixPaymentGateway } from "./gateway";
import { reconcilePaymentAttemptById } from "./reconcile";

export type PixCancelOutcome =
  | "not_pix"
  | "already_cancelled"
  | "paid_requires_refund"
  | "still_pending"
  | "cancelled"
  | "not_found";

/**
 * Cancelamento administrativo de um pedido Pix — nunca chama order_cancel
 * diretamente (que recusa com pix_order_requires_payment_flow, ver
 * supabase/migrations/0007_payments.sql). Sempre reconcilia com o
 * Mercado Pago primeiro (estado real, nunca o que está guardado): se já
 * aprovado, devolve paid_requires_refund (sem reembolso nesta tarefa); se
 * o provedor confirmar estado terminal não pago, quem cancela o pedido e
 * devolve o estoque é pix_payment_apply_provider_state (dentro da própria
 * reconciliação), nunca este módulo diretamente.
 */
export async function cancelPixOrder(orderId: string): Promise<PixCancelOutcome> {
  const client = createPaymentsServiceClient();
  const { data: order } = await client
    .from("orders")
    .select("id, store_id, payment_mode, status")
    .eq("id", orderId)
    .maybeSingle();
  if (!order) return "not_found";
  if (order.payment_mode !== "pix") return "not_pix";
  if (order.status === "cancelled") return "already_cancelled";
  if (order.status === "completed") return "paid_requires_refund";

  const { data: attempt } = await client.from("order_payments").select("*").eq("order_id", orderId).maybeSingle();
  if (!attempt) return "still_pending";

  if (attempt.status === "approved") return "paid_requires_refund";
  if (attempt.status === "rejected" || attempt.status === "cancelled" || attempt.status === "expired") {
    return "already_cancelled";
  }

  if (attempt.status === "pending" && attempt.provider_payment_id) {
    const credentials = await getStorePaymentCredentials(order.store_id);
    if (credentials) {
      const gateway = getPixPaymentGateway();
      await gateway.cancelPayment?.({
        paymentId: attempt.provider_payment_id,
        credentials: { accessToken: credentials.accessToken, environment: credentials.environment },
      });
    }
  }

  const outcome = await reconcilePaymentAttemptById(attempt.id);
  if (outcome.attempt?.status === "approved") return "paid_requires_refund";
  if (outcome.attempt && ["rejected", "cancelled", "expired"].includes(outcome.attempt.status)) return "cancelled";
  return "still_pending";
}

/** Botão "Reconciliar" do painel — mesma reconciliação usada pelo webhook/cron, disparada manualmente. */
export async function reconcileOrderPayment(orderId: string): Promise<boolean> {
  const client = createPaymentsServiceClient();
  const { data: attempt } = await client.from("order_payments").select("id").eq("order_id", orderId).maybeSingle();
  if (!attempt) return false;
  const outcome = await reconcilePaymentAttemptById(attempt.id);
  return outcome.ok;
}
