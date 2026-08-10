import "server-only";
import { createPaymentsServiceClient } from "@/lib/payments/service-only/client";
import { getPlatformPaymentCredentials } from "@/lib/payments/service-only/platform-credentials";
import { getPixPaymentGateway } from "@/lib/payments/gateway";
import { mapProviderStatusToInternal } from "@/lib/payments/gateway/status-mapping";
import type { Database } from "@/lib/supabase/types";

type BillingChargeRow = Database["public"]["Tables"]["billing_charges"]["Row"];

const TERMINAL_STATUSES = new Set(["approved", "rejected", "cancelled", "expired", "manual_review"]);

export interface BillingReconcileOutcome {
  ok: boolean;
  charge: BillingChargeRow | null;
  reason?:
    | "not_found"
    | "no_provider_payment_id"
    | "already_terminal"
    | "provider_unreachable"
    | "apply_failed"
    | "platform_not_configured";
}

/**
 * Núcleo único de reconciliação do billing da plataforma — busca o
 * estado REAL no Mercado Pago (nunca confia em nada recebido antes) e
 * aplica via `billing_charge_apply_provider_state`, mesma função usada
 * pelo webhook. Espelha lib/payments/reconcile.ts (contexto B); aqui
 * sempre com as credenciais da própria CaraffaStore, nunca de uma loja.
 */
export async function reconcileBillingChargeById(chargeId: string): Promise<BillingReconcileOutcome> {
  const serviceClient = createPaymentsServiceClient();

  const { data: charge } = await serviceClient
    .from("billing_charges")
    .select("*")
    .eq("id", chargeId)
    .maybeSingle();

  if (!charge) {
    return { ok: false, charge: null, reason: "not_found" };
  }

  return reconcileChargeRow(serviceClient, charge);
}

export async function reconcileBillingChargeByProviderPaymentId(providerPaymentId: string): Promise<BillingReconcileOutcome> {
  const serviceClient = createPaymentsServiceClient();

  const { data: charge } = await serviceClient
    .from("billing_charges")
    .select("*")
    .eq("provider_payment_id", providerPaymentId)
    .maybeSingle();

  if (!charge) {
    return { ok: false, charge: null, reason: "not_found" };
  }

  return reconcileChargeRow(serviceClient, charge);
}

async function reconcileChargeRow(
  serviceClient: ReturnType<typeof createPaymentsServiceClient>,
  charge: BillingChargeRow,
): Promise<BillingReconcileOutcome> {
  if (TERMINAL_STATUSES.has(charge.status)) {
    return { ok: true, charge, reason: "already_terminal" };
  }
  if (!charge.provider_payment_id) {
    // Ainda em "creating" sem provider_payment_id — a criação síncrona
    // ainda está em andamento (ou falhou antes de chegar lá); nada a
    // consultar no provedor ainda.
    return { ok: true, charge, reason: "no_provider_payment_id" };
  }

  let credentials;
  try {
    credentials = getPlatformPaymentCredentials();
  } catch {
    return { ok: false, charge, reason: "platform_not_configured" };
  }

  const gateway = getPixPaymentGateway();
  let providerState;
  try {
    providerState = await gateway.getPayment({
      paymentId: charge.provider_payment_id,
      credentials: { accessToken: credentials.accessToken, environment: credentials.environment },
    });
  } catch {
    // Sem action dedicada em audit_log_action_check para "reconciliação
    // de billing falhou" (só a de order_payments existe, TASK-005) — não
    // vale uma migration só para isto; o próximo ciclo de reconciliação
    // tenta de novo automaticamente.
    return { ok: false, charge, reason: "provider_unreachable" };
  }

  const internalStatus = mapProviderStatusToInternal(providerState.status, providerState.statusDetail);

  const { data: updated, error } = await serviceClient.rpc("billing_charge_apply_provider_state", {
    p_charge_id: charge.id,
    p_provider_payment_id: providerState.providerPaymentId,
    p_internal_status: internalStatus,
    p_provider_status: providerState.status,
    p_provider_status_detail: providerState.statusDetail,
    p_amount_cents: providerState.amountCents,
    p_currency: providerState.currency,
    p_external_reference: providerState.externalReference ?? charge.external_reference,
    p_qr_code: providerState.qrCode,
    p_qr_code_base64: providerState.qrCodeBase64,
    p_ticket_url: providerState.ticketUrl,
    p_expires_at: providerState.expiresAt,
  });

  if (error || !updated) {
    return { ok: false, charge, reason: "apply_failed" };
  }
  return { ok: true, charge: updated };
}
