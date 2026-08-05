import { OrderError } from "./service";

const MESSAGES: Record<string, string> = {
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
};

export const FIELD_LEVEL_CODES: Record<string, string> = {
  invalid_customer_name: "customerName",
  invalid_customer_phone: "customerPhone",
  invalid_fulfillment_method: "fulfillmentMethod",
  delivery_address_required: "deliveryAddress",
  invalid_delivery_address: "deliveryAddress",
  invalid_customer_notes: "customerNotes",
};

export function messageForOrderError(error: unknown): string {
  if (error instanceof OrderError) {
    return MESSAGES[error.code] ?? "Não foi possível concluir. Tente novamente.";
  }
  return "Não foi possível concluir. Tente novamente.";
}
