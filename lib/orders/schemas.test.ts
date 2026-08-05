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
