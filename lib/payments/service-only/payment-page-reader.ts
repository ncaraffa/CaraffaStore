// Sem `import "server-only"` diretamente aqui — ver a mesma nota em
// lib/payments/webhook-handler.ts: as dependências abaixo já carregam a
// marca, e removê-la só deste arquivo permite testar a lógica de
// comparação de hash com as dependências mockadas.
import { createHash, timingSafeEqual } from "node:crypto";
import { createPaymentsServiceClient } from "./client";
import { reconcilePaymentAttemptById } from "@/lib/payments/reconcile";

export interface PublicPaymentView {
  publicCode: string;
  status: string;
  amountCents: number;
  qrCode: string | null;
  qrCodeBase64: string | null;
  ticketUrl: string | null;
  expiresAt: string | null;
  createdAt: string;
  /**
   * TASK-013 — o que o comprador precisa conferir antes de pagar:
   * a conta que gerou o valor e o endereço para onde vai. Tudo vem do
   * SNAPSHOT do pedido, não da configuração atual da loja.
   *
   * Protegido pela mesma porta do resto desta view: sem o token de
   * recibo, nada disso existe (a função devolve null antes).
   */
  order: {
    subtotalCents: number;
    discountCents: number;
    shippingAmountCents: number;
    totalCents: number;
    shippingRule: string | null;
    fulfillmentMethod: string;
    deliveryAddress: string | null;
    shippingPostalCode: string | null;
    shippingStreet: string | null;
    shippingNumber: string | null;
    shippingComplement: string | null;
    shippingNeighborhood: string | null;
    shippingCity: string | null;
    shippingState: string | null;
  };
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function hashesMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "hex");
  const bufB = Buffer.from(b, "hex");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Única porta de leitura da página pública de pagamento
 * (/loja/[storeSlug]/pedido/[publicCode]/pagamento) — nunca confia em
 * publicCode sozinho: exige o token de recibo (cookie HttpOnly,
 * lib/payments/receipt-cookie.ts) batendo com o hash salvo em
 * orders.receipt_token_hash. Sem o token certo, devolve null (404 na
 * página) mesmo que o publicCode seja válido — nenhum dado do pedido,
 * QR Code ou status é revelado. Reconcilia com o provedor antes de
 * devolver quando o pagamento ainda não está num estado terminal, então a
 * página sempre mostra o estado mais atual possível ao abrir.
 */
export async function getPublicPaymentView(params: {
  storeSlug: string;
  publicCode: string;
  receiptToken: string | undefined;
}): Promise<PublicPaymentView | null> {
  if (!params.receiptToken) return null;

  const client = createPaymentsServiceClient();

  const { data: store } = await client.from("stores").select("id").eq("slug", params.storeSlug).maybeSingle();
  if (!store) return null;

  const { data: order } = await client
    .from("orders")
    .select(
      "id, public_code, receipt_token_hash, payment_mode, subtotal_cents, discount_cents, shipping_amount_cents, total_cents, shipping_rule, fulfillment_method, delivery_address, shipping_postal_code, shipping_street, shipping_number, shipping_complement, shipping_neighborhood, shipping_city, shipping_state",
    )
    .eq("public_code", params.publicCode)
    .eq("store_id", store.id)
    .maybeSingle();

  if (!order || order.payment_mode !== "pix" || !order.receipt_token_hash) return null;

  const providedHash = hashToken(params.receiptToken);
  if (!hashesMatch(providedHash, order.receipt_token_hash)) return null;

  const { data: attemptRow } = await client.from("order_payments").select("*").eq("order_id", order.id).maybeSingle();
  if (!attemptRow) return null;

  let attempt = attemptRow;
  if (attempt.status === "creating" || attempt.status === "pending") {
    const outcome = await reconcilePaymentAttemptById(attempt.id);
    if (outcome.attempt) attempt = outcome.attempt;
  }

  return {
    publicCode: order.public_code,
    status: attempt.status,
    amountCents: attempt.amount_cents,
    qrCode: attempt.qr_code,
    qrCodeBase64: attempt.qr_code_base64,
    ticketUrl: attempt.ticket_url,
    expiresAt: attempt.expires_at,
    createdAt: attempt.created_at,
    order: {
      subtotalCents: order.subtotal_cents ?? 0,
      discountCents: order.discount_cents ?? 0,
      shippingAmountCents: order.shipping_amount_cents ?? 0,
      totalCents: order.total_cents ?? attempt.amount_cents,
      shippingRule: order.shipping_rule ?? null,
      fulfillmentMethod: order.fulfillment_method ?? "pickup",
      deliveryAddress: order.delivery_address ?? null,
      shippingPostalCode: order.shipping_postal_code ?? null,
      shippingStreet: order.shipping_street ?? null,
      shippingNumber: order.shipping_number ?? null,
      shippingComplement: order.shipping_complement ?? null,
      shippingNeighborhood: order.shipping_neighborhood ?? null,
      shippingCity: order.shipping_city ?? null,
      shippingState: order.shipping_state ?? null,
    },
  };
}
