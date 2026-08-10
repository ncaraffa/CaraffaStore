// Sem `import "server-only"` diretamente aqui — mesmo raciocínio de
// lib/payments/webhook-handler.ts: todas as dependências abaixo já
// carregam a marca; deixar este arquivo sem ela permite testar o núcleo
// com dependências mockadas.
import { createHash } from "node:crypto";
import { createPaymentsServiceClient } from "@/lib/payments/service-only/client";
import { getPlatformPaymentCredentials } from "@/lib/payments/service-only/platform-credentials";
import { verifyMercadoPagoWebhookSignature } from "@/lib/payments/gateway/webhook-signature";
import { reconcileBillingChargeByProviderPaymentId } from "./reconcile";

export interface PlatformBillingWebhookInput {
  xSignature: string | null;
  xRequestId: string | null;
  action: string | null;
  dataId: string | null;
}

export interface PlatformBillingWebhookResult {
  status: number;
  body: { message: string };
}

/**
 * Núcleo puro de I/O do webhook de billing da plataforma
 * (app/api/webhooks/platform-billing/route.ts é só o adaptador HTTP em
 * cima disto) — URL própria e dedicada (nunca a mesma de
 * /api/webhooks/mercado-pago): isolamento de domínio por endereço, nunca
 * por "parece um payment id de loja ou de plataforma" dentro do payload.
 * Sempre reconcilia com o Mercado Pago de verdade (lib/billing/
 * reconcile.ts), nunca confia no corpo da notificação, depois de validar
 * a assinatura com o Webhook Secret da PRÓPRIA CaraffaStore.
 *
 * Diferença chave em relação ao webhook de loja: não existe um
 * `webhook_key` por-loja aqui (billing é single-tenant, uma credencial
 * só) — por isso o `store_id` só é conhecido DEPOIS de localizar a
 * cobrança pelo `provider_payment_id`. Se a cobrança ainda não estiver
 * vinculada (corrida rara com a criação síncrona), não há como gravar em
 * billing_webhook_events (store_id NOT NULL) — só pede retry (503), sem
 * perda: a criação síncrona ou a reconciliação seguinte resolve.
 */
export async function handlePlatformBillingWebhook(input: PlatformBillingWebhookInput): Promise<PlatformBillingWebhookResult> {
  if (!input.dataId) {
    return { status: 400, body: { message: "invalid_request" } };
  }

  let credentials;
  try {
    credentials = getPlatformPaymentCredentials();
  } catch {
    return { status: 500, body: { message: "platform_billing_not_configured" } };
  }

  const validSignature = verifyMercadoPagoWebhookSignature({
    xSignature: input.xSignature,
    xRequestId: input.xRequestId,
    dataId: input.dataId,
    secret: credentials.webhookSecret,
  });
  if (!validSignature) {
    return { status: 401, body: { message: "invalid_signature" } };
  }

  const outcome = await reconcileBillingChargeByProviderPaymentId(input.dataId);

  if (!outcome.charge) {
    return { status: 503, body: { message: "payment_not_linked_yet" } };
  }

  const serviceClient = createPaymentsServiceClient();
  const payloadHash = createHash("sha256")
    .update(`${input.dataId}:${input.action ?? ""}:${input.xRequestId ?? ""}`)
    .digest("hex");

  const processingStatus = outcome.ok ? "processed" : "error";
  const errorCode = outcome.ok ? null : (outcome.reason ?? "unknown_error");

  await serviceClient.rpc("billing_webhook_event_record", {
    p_store_id: outcome.charge.store_id,
    p_charge_id: outcome.charge.id,
    p_provider_event_id: input.xRequestId,
    p_provider_payment_id: input.dataId,
    p_action: input.action,
    p_payload_hash: payloadHash,
    p_processing_status: processingStatus,
    p_error_code: errorCode,
  });

  if (!outcome.ok && outcome.reason === "provider_unreachable") {
    return { status: 503, body: { message: "provider_unreachable" } };
  }

  return { status: 200, body: { message: "processed" } };
}
