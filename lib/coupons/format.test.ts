import { describe, expect, it } from "vitest";
import {
  basisPointsToPercent,
  centsToCurrencyInput,
  couponStatus,
  currencyToCents,
  describeDiscount,
  describeUsage,
  describeValidity,
  percentToBasisPoints,
} from "./format";
import { buyerCouponMessage, merchantCouponMessage, minimumShortfallMessage } from "./messages";

describe("percentToBasisPoints", () => {
  it("converte inteiros e decimais, aceitando vírgula do teclado brasileiro", () => {
    expect(percentToBasisPoints("10")).toBe(1000);
    expect(percentToBasisPoints("100")).toBe(10000);
    expect(percentToBasisPoints("7,5")).toBe(750);
    expect(percentToBasisPoints("0,5")).toBe(50);
  });

  /**
   * 10.1 * 100 dá 1009.9999999999999 em ponto flutuante. Sem o
   * arredondamento explícito o cupom seria gravado com 1009 basis points
   * — desconto errado por causa de binário.
   */
  it("não deixa erro de ponto flutuante virar desconto errado", () => {
    expect(percentToBasisPoints("10,1")).toBe(1010);
    expect(percentToBasisPoints("20,3")).toBe(2030);
  });

  it("rejeita percentual inutilizável", () => {
    expect(percentToBasisPoints("0")).toBeNull();
    expect(percentToBasisPoints("101")).toBeNull();
    expect(percentToBasisPoints("-5")).toBeNull();
    expect(percentToBasisPoints("abc")).toBeNull();
    expect(percentToBasisPoints("")).toBeNull();
  });

  it("volta para exibição sem lixo decimal", () => {
    expect(basisPointsToPercent(1000)).toBe("10");
    expect(basisPointsToPercent(750)).toBe("7,50");
  });
});

describe("currencyToCents", () => {
  it("aceita as formas que o comerciante realmente digita", () => {
    expect(currencyToCents("20")).toBe(2000);
    expect(currencyToCents("20,00")).toBe(2000);
    expect(currencyToCents("R$ 20,00")).toBe(2000);
    expect(currencyToCents("1.234,56")).toBe(123456);
    expect(currencyToCents("0,99")).toBe(99);
  });

  it("rejeita entrada inválida em vez de virar NaN na tela", () => {
    expect(currencyToCents("abc")).toBeNull();
    expect(currencyToCents("")).toBeNull();
    expect(currencyToCents("-10")).toBeNull();
  });

  it("faz o caminho de volta para o campo de edição", () => {
    expect(centsToCurrencyInput(2000)).toBe("20,00");
    expect(centsToCurrencyInput(99)).toBe("0,99");
  });
});

describe("couponStatus — derivado, não persistido", () => {
  const now = new Date("2026-08-18T12:00:00Z");

  it("ativo dentro da janela", () => {
    expect(couponStatus({ active: true, startsAt: null, expiresAt: null }, now)).toBe("active");
  });

  it("agendado quando ainda não começou", () => {
    expect(couponStatus({ active: true, startsAt: "2026-09-01T00:00:00Z", expiresAt: null }, now)).toBe("scheduled");
  });

  it("expirado quando a data passou", () => {
    expect(couponStatus({ active: true, startsAt: null, expiresAt: "2026-08-01T00:00:00Z" }, now)).toBe("expired");
  });

  /**
   * Desativado manualmente vence a data: se o lojista desligou, a tela
   * tem que dizer "Inativo", não "Agendado".
   */
  it("inativo manualmente tem precedência sobre a janela de datas", () => {
    expect(couponStatus({ active: false, startsAt: "2026-09-01T00:00:00Z", expiresAt: null }, now)).toBe("inactive");
    expect(couponStatus({ active: false, startsAt: null, expiresAt: null }, now)).toBe("inactive");
  });
});

describe("descrições da listagem", () => {
  it("descreve percentual e valor fixo", () => {
    expect(describeDiscount({ discountType: "percentage", discountValue: 1000 })).toBe("10% de desconto");
    // Intl usa espaco NAO separavel (U+00A0) depois do R$ — comparar com
    // espaco comum falharia por um caractere invisivel.
    expect(describeDiscount({ discountType: "fixed_amount", discountValue: 2000 })).toMatch(
      /^R\$\s20,00 de desconto$/,
    );
  });

  it("mostra utilizações com e sem limite", () => {
    expect(describeUsage({ usedCount: 34, maxUses: 200 })).toBe("34 / 200 utilizações");
    expect(describeUsage({ usedCount: 34, maxUses: null })).toBe("34 · utilizações ilimitadas");
  });

  it("descreve validade só quando existe", () => {
    expect(describeValidity({ startsAt: null, expiresAt: null })).toBeNull();
    expect(describeValidity({ startsAt: null, expiresAt: "2026-12-25T00:00:00Z" })).toContain("Válido até");
  });
});

describe("mensagens", () => {
  it("o comerciante recebe o motivo exato", () => {
    expect(merchantCouponMessage("coupon_code_taken")).toMatch(/já existe/i);
    expect(merchantCouponMessage("coupons_not_available")).toContain("Crescimento");
  });

  /**
   * Vários motivos colapsam em "Cupom inválido" para o comprador: dizer
   * "existe mas está inativo" entregaria informação sobre a loja.
   */
  it("o comprador não descobre se o cupom existe", () => {
    expect(buyerCouponMessage("coupon_not_found")).toBe("Cupom inválido.");
    expect(buyerCouponMessage("coupon_inactive")).toBe("Cupom inválido.");
    expect(buyerCouponMessage("coupons_not_available")).toBe("Cupom inválido.");
  });

  it("motivos acionáveis pelo comprador são explicados", () => {
    expect(buyerCouponMessage("coupon_expired")).toContain("expirou");
    expect(buyerCouponMessage("coupon_usage_limit_reached")).toContain("limite");
    expect(buyerCouponMessage("coupon_minimum_not_met")).toContain("valor mínimo");
  });

  /** O comprador nunca ouve falar do provedor de pagamento. */
  it("total-zero não menciona Mercado Pago nem Pix", () => {
    const msg = buyerCouponMessage("coupon_would_zero_total");
    expect(msg).not.toMatch(/mercado|pago|pix|R\$0/i);
    expect(msg).toContain("ultrapassa o valor permitido");
  });

  it("diz quanto falta para o mínimo", () => {
    expect(minimumShortfallMessage(8500, 10000)).toMatch(/15,00/);
  });
});
