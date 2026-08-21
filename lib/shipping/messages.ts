/**
 * Códigos de erro levantados pelas funções SQL de frete
 * (supabase/migrations/0025_store_shipping.sql) traduzidos para quem
 * está na tela. Mesmo padrão de lib/orders/messages.ts e
 * lib/coupons/messages.ts: o código nunca é inventado no TypeScript,
 * sempre vem de `error.message` do RPC.
 *
 * Duas audiências separadas de propósito. O lojista pode ouvir "informe
 * o CEP da loja"; o comprador não pode ouvir nada sobre a configuração
 * interna da loja onde está comprando.
 */

export const MERCHANT_MESSAGES: Record<string, string> = {
  insufficient_privilege: "Você não tem permissão para configurar o frete desta loja.",
  origin_required: "Para oferecer entrega, informe o CEP da loja (e confirme cidade e estado).",
  invalid_origin_postal_code: "Informe um CEP válido, com 8 dígitos.",
  invalid_origin_city: "Informe a cidade da loja.",
  invalid_origin_state: "Informe o estado da loja (duas letras, como MS).",
  invalid_shipping_fee: "Os valores de frete não podem ser negativos.",
  shipping_fee_too_high: "Valor de frete muito alto. O limite por faixa é R$ 10.000,00.",
  invalid_free_shipping_minimum: "Informe a partir de qual valor a compra ganha frete grátis.",
};

export function merchantShippingMessage(code: string): string {
  return MERCHANT_MESSAGES[code] ?? "Não foi possível salvar o frete. Tente novamente.";
}

/**
 * Erros que o comprador pode ver no checkout. Nada aqui revela
 * configuração da loja — só o que ele mesmo pode corrigir.
 */
export const BUYER_MESSAGES: Record<string, string> = {
  invalid_shipping_postal_code: "Informe um CEP válido, com 8 dígitos.",
  invalid_shipping_street: "Informe a rua.",
  invalid_shipping_number: "Informe o número.",
  invalid_shipping_complement: "Complemento muito longo.",
  invalid_shipping_neighborhood: "Bairro muito longo.",
  invalid_shipping_city: "Informe a cidade.",
  invalid_shipping_state: "Informe o estado (duas letras, como MS).",
};

/** Campo do formulário de checkout ao qual cada erro pertence. */
export const SHIPPING_FIELD_CODES: Record<string, string> = {
  invalid_shipping_postal_code: "shippingPostalCode",
  invalid_shipping_street: "shippingStreet",
  invalid_shipping_number: "shippingNumber",
  invalid_shipping_complement: "shippingComplement",
  invalid_shipping_neighborhood: "shippingNeighborhood",
  invalid_shipping_city: "shippingCity",
  invalid_shipping_state: "shippingState",
};

/**
 * Motivos pelos quais a prévia do frete não pôde ser calculada. Vários
 * deles não são erro nenhum — são só "ainda falta você preencher algo",
 * e a tela usa isso para ficar quieta em vez de alarmar.
 */
export const QUOTE_MESSAGES: Record<string, string> = {
  store_not_available: "Esta loja não está disponível no momento.",
  shipping_disabled: "",
  empty_cart: "",
  invalid_postal_code: "",
  incomplete_destination: "Preencha cidade e estado para calcularmos o frete.",
  product_not_found: "Um dos produtos do carrinho não está mais disponível.",
  too_many_items: "Carrinho com itens demais.",
  invalid_item: "Um item do carrinho é inválido.",
  postal_code_not_found: "Não encontramos esse CEP. Confira o número ou preencha o endereço à mão.",
  lookup_unavailable: "A busca automática de CEP está indisponível agora. Preencha o endereço à mão — o pedido continua normalmente.",
};

export function quoteMessage(reason: string | null | undefined): string {
  if (!reason) return "";
  return QUOTE_MESSAGES[reason] ?? "Não foi possível calcular o frete agora.";
}
