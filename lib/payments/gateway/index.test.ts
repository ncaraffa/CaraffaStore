import { describe, expect, it } from "vitest";
import { selectGatewayMode } from "./select-mode";

/**
 * getPixPaymentGateway() em si (index.ts) não pode ser importado
 * diretamente em teste (`import "server-only"`, mesmo padrão de
 * lib/payments/crypto.ts) — a decisão de seleção é testada aqui via
 * select-mode.ts, que index.ts consome sem alteração.
 */
describe("selectGatewayMode", () => {
  it("seleciona 'fake' quando PAYMENT_GATEWAY_MODE=fake fora de produção", () => {
    expect(selectGatewayMode({ PAYMENT_GATEWAY_MODE: "fake", NODE_ENV: "test" })).toBe("fake");
    expect(selectGatewayMode({ PAYMENT_GATEWAY_MODE: "fake", NODE_ENV: "development" })).toBe("fake");
  });

  it("nunca permite 'fake' quando NODE_ENV=production, mesmo pedido explicitamente", () => {
    expect(() => selectGatewayMode({ PAYMENT_GATEWAY_MODE: "fake", NODE_ENV: "production" })).toThrowError(
      /nunca é permitido com NODE_ENV=production/,
    );
  });

  it("seleciona 'real' quando PAYMENT_GATEWAY_MODE não é 'fake'", () => {
    expect(selectGatewayMode({ NODE_ENV: "test" })).toBe("real");
    expect(selectGatewayMode({ PAYMENT_GATEWAY_MODE: "anything-else", NODE_ENV: "test" })).toBe("real");
  });

  it("seleciona 'real' em produção mesmo sem PAYMENT_GATEWAY_MODE definido", () => {
    expect(selectGatewayMode({ NODE_ENV: "production" })).toBe("real");
  });
});
