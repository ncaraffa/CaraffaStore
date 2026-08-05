// Sem `import "server-only"` diretamente aqui — todas as dependências
// abaixo (client.ts, credentials-reader.ts, reconcile.ts) já carregam a
// marca; qualquer alcance a partir de um Client Component já quebraria o
// build por causa delas. Deixar este arquivo sem a marca direta é o que
// permite testar o núcleo do handler com as dependências mockadas em
// lib/payments/webhook-handler.test.ts (o pacote `server-only` lança em
// qualquer runtime fora do Next.js, inclusive no Vitest).
import { createHash } from "node:crypto";
import { createPaymentsServiceClient } from "./service-only/client";
import { getStorePaymentCredentialsByWebhookKey } from "./service-only/credentials-reader";
import { verifyMercadoPagoWebhookSignature } from "./gateway/webhook-signature";
import { reconcilePaymentAttemptByProviderPaymentId } from "./reconcile";

export interface WebhookRequestInput {
  webhookKey: string | null;
  xSignature: string | null;
  xRequestId: string | null;
  action: string | null;
  dataId: string | null;
}

export interface WebhookHandlerResult {
  status: number;
  body: { message: string };
}

/**
 * Núcleo puro de I/O do webhook (app/api/webhooks/mercado-pago/route.ts é
 * só o adaptador HTTP em cima disto) — sempre reconcilia com o Mercado
 * Pago de verdade (lib/payments/reconcile.ts, nunca confia no corpo da
 * notificação) depois de validar client/webhook_key + assinatura. Como a
 * reconciliação em si é idempotente (pix_payment_apply_provider_state
 * trava a linha do pagamento), duas entregas concorrentes do mesmo
 * webhook nunca duplicam o efeito de negócio mesmo sem um passo de dedup
 * anterior — o registro em payment_webhook_events é só para auditoria/
 * histórico, com UNIQUE (store_id, provider_payment_id, payload_hash)
 * absorvendo redeliveries idênticas sem erro.
 */
export async function handleMercadoPagoWebhook(input: WebhookRequestInput): Promise<WebhookHandlerResult> {
  if (!input.webhookKey || !input.dataId) {
    return { status: 400, body: { message: "invalid_request" } };
  }

  const credentials = await getStorePaymentCredentialsByWebhookKey(input.webhookKey);
  if (!credentials) {
    return { status: 401, body: { message: "unknown_webhook_key" } };
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

  const outcome = await reconcilePaymentAttemptByProviderPaymentId(credentials.storeId, input.dataId);

  const serviceClient = createPaymentsServiceClient();
  const payloadHash = createHash("sha256")
    .update(`${input.dataId}:${input.action ?? ""}:${input.xRequestId ?? ""}`)
    .digest("hex");

  const processingStatus = !outcome.attempt ? "error" : outcome.ok ? "processed" : "error";
  const errorCode = !outcome.attempt ? "payment_not_linked_yet" : outcome.ok ? null : (outcome.reason ?? "unknown_error");

  await serviceClient.rpc("pix_webhook_event_record", {
    p_store_id: credentials.storeId,
    p_payment_attempt_id: outcome.attempt?.id ?? null,
    p_provider_event_id: input.xRequestId,
    p_provider_payment_id: input.dataId,
    p_action: input.action,
    p_payload_hash: payloadHash,
    p_processing_status: processingStatus,
    p_error_code: errorCode,
  });

  if (!outcome.attempt) {
    // Ainda não vinculado no nosso lado (corrida rara com a criação
    // síncrona) — 5xx pede ao Mercado Pago para tentar de novo mais tarde.
    return { status: 503, body: { message: "payment_not_linked_yet" } };
  }
  if (!outcome.ok && outcome.reason === "provider_unreachable") {
    return { status: 503, body: { message: "provider_unreachable" } };
  }

  return { status: 200, body: { message: "processed" } };
}
