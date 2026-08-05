/**
 * Lógica pura de seleção de gateway, separada de index.ts (que tem
 * `import "server-only"` e por isso não pode ser importado diretamente
 * em teste — mesmo padrão de lib/payments/crypto.ts/crypto-core.ts).
 *
 * Falha segura: `PAYMENT_GATEWAY_MODE=fake` só é honrado fora de
 * produção — se `NODE_ENV=production` chegar aqui com o modo fake pedido
 * (configuração errada), lança em vez de aceitar pagamentos falsos
 * silenciosamente.
 */
export type GatewaySelection = "fake" | "real";

export function selectGatewayMode(env: {
  PAYMENT_GATEWAY_MODE?: string;
  NODE_ENV?: string;
}): GatewaySelection {
  if (env.PAYMENT_GATEWAY_MODE === "fake") {
    if (env.NODE_ENV === "production") {
      throw new Error("PAYMENT_GATEWAY_MODE=fake nunca é permitido com NODE_ENV=production.");
    }
    return "fake";
  }
  return "real";
}
