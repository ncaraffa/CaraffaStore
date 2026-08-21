import { describe, expect, it } from "vitest";
import { checkoutSchema, cartItemSchema } from "./schemas";

const validItem = { productId: "11111111-1111-4111-8111-111111111111", quantity: 2 };

function baseCheckout(overrides: Record<string, unknown> = {}) {
  return {
    customerName: "Maria Cliente",
    customerPhone: "11999998888",
    payerEmail: "maria@example.test",
    payerDocument: "111.444.777-35",
    fulfillmentMethod: "pickup",
    deliveryAddress: "",
    customerNotes: "",
    idempotencyKey: "22222222-2222-4222-8222-222222222222",
    items: [validItem],
    ...overrides,
  };
}

describe("cartItemSchema", () => {
  it("aceita quantidade inteira entre 1 e 999", () => {
    expect(cartItemSchema.safeParse({ productId: validItem.productId, quantity: 1 }).success).toBe(true);
    expect(cartItemSchema.safeParse({ productId: validItem.productId, quantity: 999 }).success).toBe(true);
  });

  it("rejeita quantidade zero, negativa, decimal ou acima de 999", () => {
    expect(cartItemSchema.safeParse({ productId: validItem.productId, quantity: 0 }).success).toBe(false);
    expect(cartItemSchema.safeParse({ productId: validItem.productId, quantity: -1 }).success).toBe(false);
    expect(cartItemSchema.safeParse({ productId: validItem.productId, quantity: 1.5 }).success).toBe(false);
    expect(cartItemSchema.safeParse({ productId: validItem.productId, quantity: 1000 }).success).toBe(false);
  });

  it("rejeita productId que não é UUID", () => {
    expect(cartItemSchema.safeParse({ productId: "not-a-uuid", quantity: 1 }).success).toBe(false);
  });
});

describe("checkoutSchema", () => {
  it("aceita um pedido válido de retirada", () => {
    const result = checkoutSchema.safeParse(baseCheckout());
    expect(result.success).toBe(true);
  });

  it("rejeita nome com menos de 2 caracteres", () => {
    expect(checkoutSchema.safeParse(baseCheckout({ customerName: "M" })).success).toBe(false);
  });

  it("rejeita carrinho vazio", () => {
    expect(checkoutSchema.safeParse(baseCheckout({ items: [] })).success).toBe(false);
  });

  it("rejeita mais de 50 itens diferentes", () => {
    const items = Array.from({ length: 51 }, (_, i) => ({
      productId: `11111111-1111-4111-8111-${String(i).padStart(12, "0")}`,
      quantity: 1,
    }));
    expect(checkoutSchema.safeParse(baseCheckout({ items })).success).toBe(false);
  });

  it("entrega sem endereço é rejeitada", () => {
    const result = checkoutSchema.safeParse(baseCheckout({ fulfillmentMethod: "delivery", deliveryAddress: "" }));
    expect(result.success).toBe(false);
  });

  it("entrega com endereço é aceita", () => {
    const result = checkoutSchema.safeParse(
      baseCheckout({ fulfillmentMethod: "delivery", deliveryAddress: "Rua Um, 123" }),
    );
    expect(result.success).toBe(true);
  });

  it("retirada não exige endereço", () => {
    const result = checkoutSchema.safeParse(baseCheckout({ fulfillmentMethod: "pickup", deliveryAddress: "" }));
    expect(result.success).toBe(true);
  });

  it("rejeita idempotencyKey que não é UUID", () => {
    expect(checkoutSchema.safeParse(baseCheckout({ idempotencyKey: "nao-e-uuid" })).success).toBe(false);
  });

  it("rejeita modalidade inventada", () => {
    expect(checkoutSchema.safeParse(baseCheckout({ fulfillmentMethod: "teleporte" })).success).toBe(false);
  });

  it("rejeita observações acima de 1000 caracteres", () => {
    expect(checkoutSchema.safeParse(baseCheckout({ customerNotes: "x".repeat(1001) })).success).toBe(false);
  });

  it("rejeita endereço acima de 500 caracteres", () => {
    const result = checkoutSchema.safeParse(
      baseCheckout({ fulfillmentMethod: "delivery", deliveryAddress: "x".repeat(501) }),
    );
    expect(result.success).toBe(false);
  });

  it("rejeita e-mail do pagador inválido", () => {
    expect(checkoutSchema.safeParse(baseCheckout({ payerEmail: "nao-e-email" })).success).toBe(false);
  });

  it("rejeita ausência de e-mail do pagador", () => {
    expect(checkoutSchema.safeParse(baseCheckout({ payerEmail: "" })).success).toBe(false);
  });

  it("rejeita documento do pagador muito curto", () => {
    expect(checkoutSchema.safeParse(baseCheckout({ payerDocument: "123" })).success).toBe(false);
  });
});

/**
 * TASK-013 — qual endereço o checkout exige depende de a loja ter frete
 * configurado. Estas asserções são só o primeiro filtro (evitam uma
 * viagem ao banco por um erro óbvio); a fonte de verdade continua sendo
 * create_order, provada em supabase/tests/shipping_check.sql.
 */
function deliveryWithShipping(overrides: Record<string, unknown> = {}) {
  return baseCheckout({
    fulfillmentMethod: "delivery",
    shippingEnabled: true,
    shippingPostalCode: "79002-000",
    shippingStreet: "Rua 14 de Julho",
    shippingNumber: "500",
    shippingNeighborhood: "Centro",
    shippingCity: "Campo Grande",
    shippingState: "MS",
    ...overrides,
  });
}

describe("checkoutSchema — endereço estruturado (loja com frete)", () => {
  it("aceita um endereço completo", () => {
    expect(checkoutSchema.safeParse(deliveryWithShipping()).success).toBe(true);
  });

  it("não exige o endereço em texto livre quando o estruturado está presente", () => {
    expect(checkoutSchema.safeParse(deliveryWithShipping({ deliveryAddress: "" })).success).toBe(true);
  });

  it("CEP é obrigatório e precisa ter 8 dígitos", () => {
    expect(checkoutSchema.safeParse(deliveryWithShipping({ shippingPostalCode: "" })).success).toBe(false);
    expect(checkoutSchema.safeParse(deliveryWithShipping({ shippingPostalCode: "7900" })).success).toBe(false);
  });

  it("aceita o CEP com ou sem máscara — a pontuação é da tela", () => {
    expect(checkoutSchema.safeParse(deliveryWithShipping({ shippingPostalCode: "79002000" })).success).toBe(true);
    expect(checkoutSchema.safeParse(deliveryWithShipping({ shippingPostalCode: "79002-000" })).success).toBe(true);
  });

  it("rua, número, cidade e UF são obrigatórios", () => {
    for (const field of ["shippingStreet", "shippingNumber", "shippingCity", "shippingState"]) {
      expect(checkoutSchema.safeParse(deliveryWithShipping({ [field]: "" })).success).toBe(false);
    }
  });

  it("bairro e complemento são opcionais", () => {
    const result = checkoutSchema.safeParse(
      deliveryWithShipping({ shippingNeighborhood: "", shippingComplement: "" }),
    );
    expect(result.success).toBe(true);
  });

  it("UF tem que ser sigla de duas letras", () => {
    expect(checkoutSchema.safeParse(deliveryWithShipping({ shippingState: "M" })).success).toBe(false);
    expect(checkoutSchema.safeParse(deliveryWithShipping({ shippingState: "M5" })).success).toBe(false);
    expect(checkoutSchema.safeParse(deliveryWithShipping({ shippingState: "ms" })).success).toBe(true);
  });

  it("retirada não exige endereço nenhum, mesmo com frete configurado", () => {
    const result = checkoutSchema.safeParse(
      baseCheckout({ fulfillmentMethod: "pickup", shippingEnabled: true }),
    );
    expect(result.success).toBe(true);
  });

  it("loja SEM frete continua no caminho antigo: endereço livre obrigatório, estruturado ignorado", () => {
    expect(
      checkoutSchema.safeParse(
        baseCheckout({ fulfillmentMethod: "delivery", shippingEnabled: false, deliveryAddress: "" }),
      ).success,
    ).toBe(false);
    expect(
      checkoutSchema.safeParse(
        baseCheckout({ fulfillmentMethod: "delivery", shippingEnabled: false, deliveryAddress: "Rua Antiga, 45" }),
      ).success,
    ).toBe(true);
  });
});
