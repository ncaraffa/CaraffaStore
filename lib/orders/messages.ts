export const MESSAGES: Record<string, string> = {
  store_not_found: "Loja não encontrada.",
  store_not_active: "Esta loja não está disponível no momento.",
  empty_cart: "Seu carrinho está vazio.",
  too_many_items: "Carrinho com itens demais.",
  invalid_item: "Um item do carrinho é inválido.",
  invalid_customer_name: "Informe um nome válido.",
  invalid_customer_phone: "Informe um telefone válido.",
  invalid_fulfillment_method: "Selecione retirada ou entrega.",
  delivery_address_required: "Informe o endereço de entrega.",
  invalid_delivery_address: "Endereço inválido.",
  invalid_customer_notes: "Observações muito longas.",
  invalid_idempotency_key: "Falha ao processar o pedido. Recarregue a página e tente novamente.",
  idempotency_conflict: "Este pedido já foi enviado com dados diferentes. Recarregue a página e tente novamente.",
  product_not_found: "Um dos produtos do carrinho não foi encontrado.",
  product_store_mismatch: "Um dos produtos não pertence a esta loja.",
  product_not_available: "Um dos produtos não está mais disponível.",
  insufficient_stock: "Estoque insuficiente para um dos itens do carrinho.",
  stock_would_be_negative: "Estoque insuficiente para um dos itens do carrinho.",
  insufficient_privilege: "Você não tem permissão para esta ação.",
  order_not_found: "Pedido não encontrado.",
  invalid_status_transition: "Essa alteração de status não é permitida.",
  payment_not_approved: "Este pedido só é confirmado automaticamente quando o Pix for aprovado.",
  paid_order_requires_refund: "Pedido já pago não pode ser cancelado por aqui — é necessário reembolso.",
  pix_order_requires_payment_flow: "Pedidos com Pix são cancelados pela tela de pagamento, não por aqui.",
  payment_pending_requires_reconciliation: "O pagamento ainda está pendente — confira o status no provedor antes de cancelar.",
  pix_not_configured: "Esta loja ainda não está pronta para receber pagamentos. Tente novamente mais tarde.",
  payment_attempt_failed: "Não foi possível iniciar o pagamento. Tente novamente.",
  payment_provider_unavailable: "O sistema de pagamento está indisponível no momento. Tente novamente em instantes.",
  payment_creation_failed: "Não foi possível gerar a cobrança Pix. Tente novamente.",
};

export const FIELD_LEVEL_CODES: Record<string, string> = {
  invalid_customer_name: "customerName",
  invalid_customer_phone: "customerPhone",
  invalid_fulfillment_method: "fulfillmentMethod",
  delivery_address_required: "deliveryAddress",
  invalid_delivery_address: "deliveryAddress",
  invalid_customer_notes: "customerNotes",
};

function hasErrorCode(error: unknown): error is { code: string } {
  return typeof error === "object" && error !== null && "code" in error && typeof (error as { code: unknown }).code === "string";
}

/**
 * Aceita OrderError (TASK-004) e qualquer outro erro com o mesmo formato
 * `{ code: string }` — PixCheckoutError (lib/payments/checkout-orchestration.ts)
 * reencaminha os códigos de OrderError e adiciona os seus próprios, ambos
 * cobertos pelo mesmo MESSAGES acima.
 */
export function messageForOrderError(error: unknown): string {
  if (hasErrorCode(error)) {
    return MESSAGES[error.code] ?? "Não foi possível concluir. Tente novamente.";
  }
  return "Não foi possível concluir. Tente novamente.";
}
