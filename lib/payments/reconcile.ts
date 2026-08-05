import "server-only";
import { createPaymentsServiceClient } from "./service-only/client";
import { getStorePaymentCredentials } from "./service-only/credentials-reader";
import { getPixPaymentGateway } from "./gateway";
import { mapProviderStatusToInternal } from "./gateway/status-mapping";
import { MercadoPagoGatewayError } from "./gateway/mercado-pago";
import type { Database } from "@/lib/supabase/types";

type OrderPaymentRow = Database["public"]["Tables"]["order_payments"]["Row"];

const TERMINAL_STATUSES = new Set(["approved", "rejected", "cancelled", "expired", "manual_review"]);

export interface ReconcileOutcome {
  ok: boolean;
  attempt: OrderPaymentRow | null;
  reason?: "not_found" | "no_provider_payment_id" | "already_terminal" | "provider_unreachable" | "apply_failed";
}

/**
 * Núcleo único de reconciliação — busca o estado REAL no Mercado Pago
 * (nunca confia em nada recebido antes) e aplica via
 * pix_payment_apply_provider_state (mesma função que o webhook usa, ver
 * supabase/migrations/0007_payments.sql). Chamada por: o próprio webhook
 * (depois de validar a assinatura), a rota de cron
 * (app/api/cron/payments/reconcile/route.ts), a página pública de
 * pagamento (ao abrir/"atualizar status") e o botão "Reconciliar" do
 * painel — sempre o mesmo caminho, nunca uma cópia divergente da lógica.
 */
export async function reconcilePaymentAttemptById(paymentAttemptId: string): Promise<ReconcileOutcome> {
  const serviceClient = createPaymentsServiceClient();

  const { data: attempt } = await serviceClient
    .from("order_payments")
    .select("*")
    .eq("id", paymentAttemptId)
    .maybeSingle();

  if (!attempt) {
    return { ok: false, attempt: null, reason: "not_found" };
  }

  return reconcileAttemptRow(serviceClient, attempt);
}

export async function reconcilePaymentAttemptByProviderPaymentId(
  storeId: string,
  providerPaymentId: string,
): Promise<ReconcileOutcome> {
  const serviceClient = createPaymentsServiceClient();

  const { data: attempt } = await serviceClient
    .from("order_payments")
    .select("*")
    .eq("store_id", storeId)
    .eq("provider_payment_id", providerPaymentId)
    .maybeSingle();

  if (!attempt) {
    return { ok: false, attempt: null, reason: "not_found" };
  }

  return reconcileAttemptRow(serviceClient, attempt);
}

async function reconcileAttemptRow(
  serviceClient: ReturnType<typeof createPaymentsServiceClient>,
  attempt: OrderPaymentRow,
): Promise<ReconcileOutcome> {
  if (TERMINAL_STATUSES.has(attempt.status)) {
    return { ok: true, attempt, reason: "already_terminal" };
  }
  if (!attempt.provider_payment_id) {
    // Ainda em "creating" sem provider_payment_id — a criação síncrona
    // ainda está em andamento (ou falhou antes de chegar lá); nada a
    // consultar no provedor ainda.
    return { ok: true, attempt, reason: "no_provider_payment_id" };
  }

  const credentials = await getStorePaymentCredentials(attempt.store_id);
  if (!credentials) {
    return { ok: false, attempt, reason: "not_found" };
  }

  const gateway = getPixPaymentGateway();
  let providerState;
  try {
    providerState = await gateway.getPayment({
      paymentId: attempt.provider_payment_id,
      credentials: { accessToken: credentials.accessToken, environment: credentials.environment },
    });
  } catch (error) {
    await serviceClient.from("audit_log").insert({
      actor_user_id: null,
      store_id: attempt.store_id,
      action: "pix_payment_reconciliation_failed",
      target_type: "order_payment",
      target_id: attempt.id,
      metadata: { error_code: error instanceof MercadoPagoGatewayError ? error.code : "unknown_error" },
    });
    return { ok: false, attempt, reason: "provider_unreachable" };
  }

  const internalStatus = mapProviderStatusToInternal(providerState.status, providerState.statusDetail);

  const { data: updated, error } = await serviceClient.rpc("pix_payment_apply_provider_state", {
    p_payment_attempt_id: attempt.id,
    p_provider_payment_id: providerState.providerPaymentId,
    p_internal_status: internalStatus,
    p_provider_status: providerState.status,
    p_provider_status_detail: providerState.statusDetail,
    p_amount_cents: providerState.amountCents,
    p_currency: providerState.currency,
    p_external_reference: providerState.externalReference ?? attempt.external_reference,
    p_qr_code: providerState.qrCode,
    p_qr_code_base64: providerState.qrCodeBase64,
    p_ticket_url: providerState.ticketUrl,
    p_expires_at: providerState.expiresAt,
  });

  if (error || !updated) {
    return { ok: false, attempt, reason: "apply_failed" };
  }
  return { ok: true, attempt: updated };
}
