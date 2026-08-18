/**
 * Códigos crus do banco -> frases humanas.
 *
 * Duas plateias diferentes, dois mapas diferentes:
 *
 *  - o COMERCIANTE pode saber o motivo exato (é a loja dele);
 *  - o COMPRADOR recebe o mínimo necessário. Nada aqui revela se um
 *    cupom existe em outra loja, qual é o limite de utilizações ou por
 *    que exatamente o desconto não coube.
 */

const MERCHANT_MESSAGES: Record<string, string> = {
  coupons_not_available: "Cupons estão disponíveis a partir do plano Crescimento.",
  coupon_code_taken: "Já existe um cupom com este código nesta loja.",
  invalid_coupon_code: "Use de 3 a 32 caracteres: letras, números, hífen ou underscore.",
  invalid_discount_type: "Selecione o tipo de desconto.",
  invalid_discount_value: "Informe um desconto válido.",
  max_discount_only_for_percentage: "O desconto máximo só se aplica a cupons percentuais.",
  invalid_minimum_order: "Informe um valor mínimo válido.",
  invalid_maximum_discount: "Informe um desconto máximo válido.",
  invalid_date_range: "A data final deve ser posterior à data inicial.",
  invalid_max_uses: "O limite de utilizações deve ser maior que zero.",
  coupon_not_found: "Cupom não encontrado.",
  insufficient_privilege: "Você não tem permissão para gerenciar cupons desta loja.",
};

/**
 * Para o comprador. Repare que vários motivos distintos colapsam em
 * "Cupom inválido" de propósito: dizer "este cupom existe mas está
 * inativo" já entrega informação sobre a loja que ele não precisa ter.
 */
const BUYER_MESSAGES: Record<string, string> = {
  coupon_not_found: "Cupom inválido.",
  coupon_inactive: "Cupom inválido.",
  coupons_not_available: "Cupom inválido.",
  coupon_expired: "Este cupom expirou.",
  coupon_not_started: "Este cupom ainda não está disponível.",
  coupon_minimum_not_met: "O valor mínimo do pedido ainda não foi atingido.",
  coupon_usage_limit_reached: "Este cupom atingiu o limite de utilizações.",
  // Nunca mencionar o provedor de pagamento nem o piso de cobrança para
  // o comprador — é detalhe interno nosso.
  coupon_would_zero_total:
    "Este cupom não pode ser aplicado porque o desconto ultrapassa o valor permitido para este pedido.",
};

export function merchantCouponMessage(code: string | null | undefined): string {
  if (!code) return "Não foi possível concluir. Tente novamente.";
  const hit = Object.keys(MERCHANT_MESSAGES).find((key) => code.includes(key));
  return hit ? MERCHANT_MESSAGES[hit]! : "Não foi possível concluir. Tente novamente.";
}

export function buyerCouponMessage(reason: string | null | undefined): string {
  if (!reason) return "Não foi possível aplicar este cupom.";
  const hit = Object.keys(BUYER_MESSAGES).find((key) => reason.includes(key));
  return hit ? BUYER_MESSAGES[hit]! : "Não foi possível aplicar este cupom.";
}

/**
 * Mensagem com o quanto falta para o mínimo. Só é usada quando o motivo
 * é justamente o mínimo — aí o número ajuda o comprador a decidir, em vez
 * de deixá-lo adivinhando.
 */
export function minimumShortfallMessage(subtotalCents: number, minimumCents: number): string {
  const missing = Math.max(0, minimumCents - subtotalCents);
  const formatted = (missing / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  return `Faltam ${formatted} para atingir o valor mínimo deste cupom.`;
}
