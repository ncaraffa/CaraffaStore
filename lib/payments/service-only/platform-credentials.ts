import "server-only";
import type { PixPaymentEnvironment } from "@/lib/supabase/types";

export class PlatformBillingConfigError extends Error {
  code: string;
  constructor(code: string) {
    super(code);
    this.name = "PlatformBillingConfigError";
    this.code = code;
  }
}

export interface PlatformPaymentCredentials {
  accessToken: string;
  webhookSecret: string;
  environment: PixPaymentEnvironment;
}

/**
 * Credenciais de pagamento da PRÓPRIA CaraffaStore, usadas para cobrar o
 * COMERCIANTE pela assinatura — nunca as de `store_payment_settings`
 * (loja cobrando cliente final, lib/payments/service-only/credentials-
 * reader.ts). Vivem só em variável de ambiente do processo Next.js:
 * `PLATFORM_MP_ACCESS_TOKEN` / `PLATFORM_MP_WEBHOOK_SECRET` /
 * `PLATFORM_MP_ENVIRONMENT` — nunca no banco, sem criptografia própria
 * (não há linha para descriptografar), nunca `NEXT_PUBLIC_`, nunca
 * logadas. `PAYMENT_GATEWAY_MODE=fake` (lib/payments/gateway/select-
 * mode.ts) já cobre o billing da plataforma automaticamente — mesmo
 * processo, mesma seleção de gateway.
 */
export function getPlatformPaymentCredentials(): PlatformPaymentCredentials {
  const accessToken = process.env.PLATFORM_MP_ACCESS_TOKEN;
  const webhookSecret = process.env.PLATFORM_MP_WEBHOOK_SECRET;

  if (!accessToken || !webhookSecret) {
    throw new PlatformBillingConfigError("platform_billing_not_configured");
  }

  const environment: PixPaymentEnvironment = process.env.PLATFORM_MP_ENVIRONMENT === "production" ? "production" : "test";

  return { accessToken, webhookSecret, environment };
}
