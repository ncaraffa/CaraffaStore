import "server-only";
import { createHash, randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, PixDocType } from "@/lib/supabase/types";
import { getPublicStore } from "@/lib/catalog/service";
import { createOrder, OrderError } from "@/lib/orders/service";
import { createPaymentsServiceClient } from "@/lib/payments/service-only/client";
import { getStorePaymentCredentials } from "@/lib/payments/service-only/credentials-reader";
import { getPixPaymentGateway } from "@/lib/payments/gateway";
import { MercadoPagoGatewayError } from "@/lib/payments/gateway/mercado-pago";
import { absoluteUrl } from "@/lib/auth/site-url";

type Client = SupabaseClient<Database>;

/**
 * Orquestra o checkout público inteiro (TASK-005): valida a loja/Pix,
 * cria o pedido (create_order, TASK-004, sem alteração), cria a tentativa
 * de pagamento e chama o Mercado Pago — nesta ordem, porque Postgres e o
 * provedor não participam da mesma transação (comentário no topo de
 * supabase/migrations/0007_payments.sql). server-only: descriptografa o
 * Access Token da loja e nunca pode ser alcançado por um Client Component.
 */
export class PixCheckoutError extends Error {
  code: string;
  constructor(code: string) {
    super(code);
    this.name = "PixCheckoutError";
    this.code = code;
  }
}

export interface PixCheckoutParams {
  storeSlug: string;
  idempotencyKey: string;
  customerName: string;
  customerPhone: string;
  fulfillmentMethod: "pickup" | "delivery";
  deliveryAddress?: string;
  customerNotes?: string;
  payerEmail: string;
  payerDocType: PixDocType;
  payerDocNumber: string;
  items: { productId: string; quantity: number }[];
}

export interface PixCheckoutResult {
  publicCode: string;
  totalCents: number;
  receiptToken: string;
  status: string;
  qrCode: string | null;
  qrCodeBase64: string | null;
  ticketUrl: string | null;
  expiresAt: string | null;
}

function generateReceiptToken(): string {
  return randomBytes(32).toString("base64url");
}

function hashReceiptToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** X-Idempotency-Key estável, determinística a partir do id do pedido — nunca regenerada em retry. Máx. 64 caracteres. */
function buildProviderIdempotencyKey(orderId: string): string {
  return `pix-${orderId.replace(/-/g, "")}`.slice(0, 64);
}

export async function createPixCheckout(supabase: Client, params: PixCheckoutParams): Promise<PixCheckoutResult> {
  const store = await getPublicStore(supabase, params.storeSlug);
  if (!store) {
    throw new PixCheckoutError("store_not_found");
  }

  const credentials = await getStorePaymentCredentials(store.id);
  if (!credentials || !credentials.isEnabled) {
    throw new PixCheckoutError("pix_not_configured");
  }

  let order;
  try {
    order = await createOrder(supabase, {
      storeSlug: params.storeSlug,
      idempotencyKey: params.idempotencyKey,
      customerName: params.customerName,
      customerPhone: params.customerPhone,
      fulfillmentMethod: params.fulfillmentMethod,
      deliveryAddress: params.deliveryAddress,
      customerNotes: params.customerNotes,
      items: params.items,
    });
  } catch (error) {
    if (error instanceof OrderError) {
      throw new PixCheckoutError(error.code);
    }
    throw error;
  }

  const serviceClient = createPaymentsServiceClient();
  const receiptToken = generateReceiptToken();
  const receiptTokenHash = hashReceiptToken(receiptToken);
  const providerIdempotencyKey = buildProviderIdempotencyKey(order.id);

  const { data: attempt, error: attemptError } = await serviceClient.rpc("pix_payment_attempt_upsert_creating", {
    p_order_id: order.id,
    p_provider_idempotency_key: providerIdempotencyKey,
    p_amount_cents: order.total_cents,
    p_currency: "BRL",
    p_payer_email: params.payerEmail,
    p_payer_doc_type: params.payerDocType,
    p_payer_doc_last4: params.payerDocNumber.slice(-4),
    p_receipt_token_hash: receiptTokenHash,
  });

  if (attemptError || !attempt) {
    throw new PixCheckoutError("payment_attempt_failed");
  }

  if (attempt.status !== "creating") {
    // Retry depois que a tentativa já saiu de "creating" (resposta anterior
    // perdida, mas o pagamento já foi criado de verdade) — devolve o que
    // já existe, nunca chama o provedor de novo.
    return {
      publicCode: order.public_code,
      totalCents: order.total_cents,
      receiptToken,
      status: attempt.status,
      qrCode: attempt.qr_code,
      qrCodeBase64: attempt.qr_code_base64,
      ticketUrl: attempt.ticket_url,
      expiresAt: attempt.expires_at,
    };
  }

  const gateway = getPixPaymentGateway();
  const notificationUrl = absoluteUrl(`/api/webhooks/mercado-pago?client=${credentials.webhookKey}`);

  try {
    const providerPayment = await gateway.createPayment({
      credentials: { accessToken: credentials.accessToken, environment: credentials.environment },
      idempotencyKey: providerIdempotencyKey,
      amountCents: order.total_cents,
      externalReference: attempt.external_reference,
      payerEmail: params.payerEmail,
      payerDocType: params.payerDocType,
      payerDocNumber: params.payerDocNumber,
      description: `Pedido ${order.public_code}`,
      notificationUrl,
    });

    const { data: created, error: markCreatedError } = await serviceClient.rpc("pix_payment_mark_created", {
      p_payment_attempt_id: attempt.id,
      p_provider_payment_id: providerPayment.providerPaymentId,
      p_provider_status: providerPayment.status,
      p_provider_status_detail: providerPayment.statusDetail,
      p_qr_code: providerPayment.qrCode,
      p_qr_code_base64: providerPayment.qrCodeBase64,
      p_ticket_url: providerPayment.ticketUrl,
      p_expires_at: providerPayment.expiresAt,
    });

    if (markCreatedError || !created) {
      throw new PixCheckoutError("payment_attempt_failed");
    }

    return {
      publicCode: order.public_code,
      totalCents: order.total_cents,
      receiptToken,
      status: created.status,
      qrCode: created.qr_code,
      qrCodeBase64: created.qr_code_base64,
      ticketUrl: created.ticket_url,
      expiresAt: created.expires_at,
    };
  } catch (error) {
    if (error instanceof MercadoPagoGatewayError && error.transient) {
      // Erro transitório (timeout/5xx): mantém "creating" para retry com a
      // MESMA idempotency key — nunca cancela o pedido por isso.
      throw new PixCheckoutError("payment_provider_unavailable");
    }

    const errorCode = error instanceof MercadoPagoGatewayError ? error.code : "payment_creation_failed";
    await serviceClient.rpc("pix_payment_mark_creation_failed", {
      p_payment_attempt_id: attempt.id,
      p_error_code: errorCode,
    });
    throw new PixCheckoutError("payment_creation_failed");
  }
}
