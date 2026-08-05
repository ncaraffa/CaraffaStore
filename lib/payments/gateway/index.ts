import "server-only";
import { MercadoPagoPixGateway } from "./mercado-pago";
import { FakePixGateway } from "./fake";
import type { PixPaymentGateway } from "./types";

/**
 * Único ponto de seleção de gateway. Falha segura: `PAYMENT_GATEWAY_MODE
 * = "fake"` só é honrado fora de produção — se `NODE_ENV=production`
 * chegar aqui com o modo fake pedido (configuração errada), a aplicação
 * quebra alto e cedo em vez de aceitar pagamentos falsos silenciosamente.
 * Sem a variável (padrão), usa sempre o gateway real.
 */
let fakeSingleton: FakePixGateway | null = null;

export function getPixPaymentGateway(): PixPaymentGateway {
  const mode = process.env.PAYMENT_GATEWAY_MODE;

  if (mode === "fake") {
    if (process.env.NODE_ENV === "production") {
      throw new Error("PAYMENT_GATEWAY_MODE=fake nunca é permitido com NODE_ENV=production.");
    }
    fakeSingleton ??= new FakePixGateway();
    return fakeSingleton;
  }

  return new MercadoPagoPixGateway();
}

export type { PixPaymentGateway } from "./types";
export * from "./types";
