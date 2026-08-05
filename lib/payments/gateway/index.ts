import "server-only";
import { MercadoPagoPixGateway } from "./mercado-pago";
import { FakePixGateway } from "./fake";
import { selectGatewayMode } from "./select-mode";
import type { PixPaymentGateway } from "./types";

/**
 * Único ponto de seleção de gateway. A decisão em si (testável) vive em
 * select-mode.ts; este módulo só instancia. Sem a variável
 * `PAYMENT_GATEWAY_MODE` (padrão), usa sempre o gateway real.
 */
let fakeSingleton: FakePixGateway | null = null;

export function getPixPaymentGateway(): PixPaymentGateway {
  const selection = selectGatewayMode(process.env);

  if (selection === "fake") {
    fakeSingleton ??= new FakePixGateway();
    return fakeSingleton;
  }

  return new MercadoPagoPixGateway();
}

export type { PixPaymentGateway } from "./types";
export * from "./types";
