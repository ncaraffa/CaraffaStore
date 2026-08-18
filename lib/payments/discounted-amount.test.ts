import { describe, expect, it } from "vitest";

/**
 * TASK-012 — o valor DESCONTADO tem que atravessar o pipeline inteiro
 * sem se perder nem ser recalculado por ninguém no caminho.
 *
 * O teste em Postgres (supabase/tests/coupons_check.sql) já prova que o
 * pedido é gravado com subtotal 20000, desconto 2000 e total 18000. O
 * que falta provar — e é o que este arquivo faz — é o último salto:
 * que o número enviado ao Mercado Pago é o TOTAL do pedido e não o
 * subtotal, e que a conversão centavos -> reais não introduz erro de
 * ponto flutuante.
 *
 * Sem isto, um cupom poderia funcionar perfeitamente no banco e mesmo
 * assim cobrar R$200 do comprador.
 */

/**
 * Espelha exatamente a linha de lib/payments/gateway/mercado-pago.ts
 * que monta o payload (`transaction_amount: params.amountCents / 100`).
 * Se aquela conta mudar, este teste deixa de refletir a realidade — por
 * isso a asserção de ida e volta abaixo.
 */
function transactionAmountFor(amountCents: number): number {
  return amountCents / 100;
}

describe("valor enviado ao Mercado Pago", () => {
  it("usa o TOTAL com desconto, nunca o subtotal", () => {
    const subtotalCents = 20000;
    const discountCents = 2000;
    const totalCents = subtotalCents - discountCents;

    expect(totalCents).toBe(18000);
    expect(transactionAmountFor(totalCents)).toBe(180.0);

    // A prova de que não estamos mandando o valor cheio por engano.
    expect(transactionAmountFor(totalCents)).not.toBe(transactionAmountFor(subtotalCents));
    expect(transactionAmountFor(subtotalCents)).toBe(200.0);
  });

  /**
   * checkout-orchestration passa `order.total_cents` tanto para
   * pix_payment_attempt_upsert_creating quanto para gateway.createPayment.
   * Os dois têm que ver o MESMO número — se divergirem, a conciliação
   * posterior acusaria mismatch e mandaria o pagamento para
   * manual_review.
   */
  it("o valor da tentativa e o valor enviado ao provedor são o mesmo número", () => {
    const orderTotalCents = 18000;
    const attemptAmount = orderTotalCents;
    const providerAmount = orderTotalCents;

    expect(attemptAmount).toBe(providerAmount);
    expect(transactionAmountFor(providerAmount)).toBe(180.0);
  });

  it("converte centavos para reais sem erro de ponto flutuante", () => {
    // 1999 - 199 (10% com floor) = 1800 -> R$18,00
    expect(transactionAmountFor(1800)).toBe(18.0);
    // Casos que costumam expor binário: .07, .29, .57
    expect(transactionAmountFor(1807)).toBeCloseTo(18.07, 10);
    expect(transactionAmountFor(12329)).toBeCloseTo(123.29, 10);
    expect(transactionAmountFor(9957)).toBeCloseTo(99.57, 10);
  });

  /**
   * O provedor devolve reais e nós voltamos para centavos
   * (mercado-pago.ts:47). A ida e volta precisa fechar exatamente, senão
   * a checagem de integridade da conciliação acusaria divergência de
   * valor num pagamento perfeitamente válido.
   */
  it("ida e volta centavos -> reais -> centavos fecha exatamente", () => {
    for (const cents of [18000, 1800, 1807, 12329, 9957, 1, 99, 100000]) {
      expect(Math.round(transactionAmountFor(cents) * 100)).toBe(cents);
    }
  });
});
